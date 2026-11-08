import http from "node:http";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { POST } from "@/app/api/computer/lease/route";
import { handleAgent } from "../../agent-runtime/src/http";
import type { Desktop, DesktopStatus } from "../../agent-runtime/src/desktop";
import { DESKTOP_COPY, executeDesktopRequest } from "@/lib/chat/desktop-task";
import { loadTenantLease } from "@/lib/computer/lease";
import { SESSION_COOKIE } from "@/lib/cookie";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { createSessionToken } from "@/lib/session-token";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

const quietDesktop = (): Desktop => {
  const status: DesktopStatus = { ok: true, display: ":99", chromium: "up", whatsappTab: false, profileDir: "/tmp/none" };
  return {
    async screenshot() {
      return Buffer.from("png");
    },
    async perform() {
      return undefined;
    },
    async status() {
      return status;
    },
  };
};

async function listen(machineId: string, token: string, seen: { authorization: string; machineId: string; path: string }[]) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as { machineId?: string }) : {};
    seen.push({
      authorization: req.headers.authorization ?? "",
      machineId: body.machineId ?? "",
      path: req.url ?? "",
    });
    const response = await handleAgent(
      {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        body: raw ? body : undefined,
        headers: { authorization: req.headers.authorization },
      },
      { env: { AGENT_RUNTIME_TOKEN: token, MACHINE_ID: machineId, XAI_MODE: "mock" }, desktop: quietDesktop() },
    );
    res.writeHead(response.status);
    res.end(response.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, origin: `http://127.0.0.1:${port}` };
}

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("arriendo persistido del computador, solo cableado", () => {
  test("la sesión guarda el token cifrado y loadTenantLease llama al handler real", async () => {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      process.env.SESSION_SECRET = "integration-session-secret-de-32-chars";
    }
    const master = randomBytes(32).toString("base64");
    process.env.CREDENTIALS_MASTER_KEY = master;
    const token = `lease-${randomBytes(18).toString("hex")}`;
    const machineId = `machine-${randomBytes(4).toString("hex")}`;
    const seen: { authorization: string; machineId: string; path: string }[] = [];
    const worker = await listen(machineId, token, seen);

    const user = await prisma.user.create({
      data: { email: `lease-${Date.now()}@test.local`, name: "Ana", passwordHash: await hashPassword("Clave-demo-2026") },
    });
    createdUsers.push(user.id);
    const organization = await prisma.organization.create({
      data: { name: "Lease", slug: `lease-${Date.now()}-${randomBytes(3).toString("hex")}` },
    });
    createdOrgs.push(organization.id);
    const other = await prisma.organization.create({
      data: { name: "Otra", slug: `otra-${Date.now()}-${randomBytes(3).toString("hex")}` },
    });
    createdOrgs.push(other.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
    const session = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: organization.id,
      organizationName: organization.name,
      role: "OWNER",
      authVersion: user.authVersion,
    });
    cookieJar.set(SESSION_COOKIE, session);

    const response = await POST(
      new Request("http://local/api/computer/lease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machineId, endpoint: worker.origin, token }),
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, configured: true, machineId });
    expect(JSON.stringify(payload)).not.toContain(token);

    const stored = await prisma.computer.findUniqueOrThrow({ where: { clientId: organization.id } });
    expect(stored.agentTokenCiphertext).not.toContain(token);
    expect(stored.agentEndpoint).toBe(worker.origin);

    const own = await loadTenantLease(organization.id);
    expect(own.state).toBe("listo");
    if (own.state !== "listo") return;
    expect(own.lease.token).toBe(token);
    expect(own.lease.machineId).toBe(machineId);
    expect(own.lease.baseUrl).toBe(worker.origin);
    expect((await loadTenantLease(other.id)).state).toBe("ausente");

    const status = await fetch(`${worker.origin}/status`, { headers: { authorization: `Bearer ${own.lease.token}` } });
    expect(status.status).toBe(200);
    const open = await fetch(`${worker.origin}/status`);
    expect(open.status).toBe(401);

    const result = await executeDesktopRequest({
      organizationId: organization.id,
      userId: user.id,
      conversationId: "contador",
      text: "Usa el computador y abre https://example.com",
      loadLease: (organizationId) => loadTenantLease(organizationId),
      reserve: async () => ({ ok: true, reservationId: null }),
    });
    expect(result).toEqual({ kind: "reply", text: DESKTOP_COPY.NOT_REAL });
    const task = seen.find((item) => item.path === "/task");
    expect(task?.authorization).toBe(`Bearer ${token}`);
    expect(task?.machineId).toBe(machineId);

    const blocked = await POST(
      new Request("http://local/api/computer/lease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machineId, endpoint: "http://app.internal:8787", token }),
      }),
    );
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(await blocked.json())).not.toContain(token);

    await new Promise<void>((resolve, reject) => worker.server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.CREDENTIALS_MASTER_KEY;
  });
});
