import http from "node:http";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import { handleAgent } from "../../agent-runtime/src/http";
import type { Desktop, DesktopStatus } from "../../agent-runtime/src/desktop";
import { DESKTOP_COPY, executeDesktopRequest } from "@/lib/chat/desktop-task";
import { enrollComputerLease, loadTenantLease, revokeComputerLease, rotateComputerLease } from "@/lib/computer/lease";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

function quietDesktop(): Desktop {
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
}

async function listen(env: { token: string; machineId: string }, seen: { authorization: string; machineId: string; path: string }[]) {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as { machineId?: string }) : {};
    seen.push({ authorization: req.headers.authorization ?? "", machineId: body.machineId ?? "", path: req.url ?? "" });
    const response = await handleAgent(
      {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        body: raw ? body : undefined,
        headers: { authorization: req.headers.authorization },
      },
      { env: { AGENT_RUNTIME_TOKEN: env.token, MACHINE_ID: env.machineId, XAI_MODE: "mock" }, desktop: quietDesktop() },
    );
    res.writeHead(response.status);
    res.end(response.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function org(name: string, suspended = false) {
  const user = await prisma.user.create({
    data: { email: `${name}-${Date.now()}-${randomBytes(2).toString("hex")}@test.local`, name, passwordHash: await hashPassword("Clave-demo-2026") },
  });
  createdUsers.push(user.id);
  const organization = await prisma.organization.create({
    data: { name, slug: `${name}-${Date.now()}-${randomBytes(3).toString("hex")}`, suspendedAt: suspended ? new Date() : null },
  });
  createdOrgs.push(organization.id);
  return { user, organization };
}

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("alta del computador solo en el servidor, cableado local", () => {
  test("no activa sin prueba del runtime, y producción no acepta el loopback", async () => {
    const master = randomBytes(32).toString("base64");
    process.env.CREDENTIALS_MASTER_KEY = master;
    const token = `lease-${randomBytes(18).toString("hex")}`;
    const machineId = `mach-${randomBytes(4).toString("hex")}`;
    const seen: { authorization: string; machineId: string; path: string }[] = [];
    const env = { token, machineId };
    const worker = await listen(env, seen);
    const { user, organization } = await org("alta");
    const suspended = await org("susp", true);

    const closed = await enrollComputerLease(
      { organizationId: organization.id, machineId, endpoint: worker.origin, token },
      process.env,
    );
    expect(closed).toMatchObject({ ok: false, error: "datos" });

    const paused = await enrollComputerLease(
      { organizationId: suspended.organization.id, machineId, endpoint: worker.origin, token },
      process.env,
      { allowLoopback: true },
    );
    expect(paused).toMatchObject({ ok: false, error: "suspendida" });

    const enrolled = await enrollComputerLease(
      { organizationId: organization.id, machineId, endpoint: worker.origin, token },
      process.env,
      { allowLoopback: true },
    );
    expect(enrolled).toEqual({ ok: true, machineId, configured: true });
    const row = await prisma.computer.findUniqueOrThrow({ where: { clientId: organization.id } });
    expect(row.status).toBe("RUNNING");
    expect(row.agentTokenCiphertext).not.toContain(token);

    expect((await loadTenantLease(organization.id)).state).toBe("transporte");
    const ready = await loadTenantLease(organization.id, process.env, { allowLoopback: true });
    expect(ready.state).toBe("listo");
    if (ready.state !== "listo") return;

    const status = await fetch(`${worker.origin}/status`, { headers: { authorization: `Bearer ${ready.lease.token}` } });
    expect(status.status).toBe(200);
    expect((await fetch(`${worker.origin}/status`)).status).toBe(401);

    const result = await executeDesktopRequest({
      organizationId: organization.id,
      userId: user.id,
      conversationId: "contador",
      text: "Usa el computador y abre https://example.com",
      allowLoopback: true,
      loadLease: (organizationId) => loadTenantLease(organizationId, process.env, { allowLoopback: true }),
      reserve: async () => ({ ok: true, reservationId: null }),
    });
    expect(result).toEqual({ kind: "reply", text: DESKTOP_COPY.NOT_REAL });
    expect(seen.some((item) => item.path === "/task" && item.authorization === `Bearer ${token}` && item.machineId === machineId)).toBe(true);

    const other = await org("otra");
    const stolen = await enrollComputerLease(
      { organizationId: other.organization.id, machineId, endpoint: worker.origin, token: `otro-${randomBytes(18).toString("hex")}` },
      process.env,
      { allowLoopback: true },
    );
    expect(stolen).toMatchObject({ ok: false, error: "maquina" });

    await prisma.computer.update({
      where: { clientId: organization.id },
      data: { status: "RUNNING", agentTokenCiphertext: "forjado", agentTokenIv: "forjado", agentTokenAuthTag: "forjado" },
    });
    expect((await loadTenantLease(organization.id, process.env, { allowLoopback: true })).state).toBe("transporte");

    await revokeComputerLease(organization.id);
    expect((await loadTenantLease(organization.id, process.env, { allowLoopback: true })).state).toBe("ausente");

    await new Promise<void>((resolve, reject) => worker.server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.CREDENTIALS_MASTER_KEY;
  });

  test("un redirect no activa y rotar a un token que el runtime niega no reemplaza el anterior", async () => {
    const master = randomBytes(32).toString("base64");
    process.env.CREDENTIALS_MASTER_KEY = master;
    const token = `lease-${randomBytes(18).toString("hex")}`;
    const machineId = `mach-${randomBytes(4).toString("hex")}`;
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: "http://127.0.0.1:9/" });
      res.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", () => resolve()));
    const redirectAddress = redirector.address();
    const redirectPort = typeof redirectAddress === "object" && redirectAddress ? redirectAddress.port : 0;
    const { organization } = await org("redir");
    const bounced = await enrollComputerLease(
      { organizationId: organization.id, machineId, endpoint: `http://127.0.0.1:${redirectPort}`, token },
      process.env,
      { allowLoopback: true },
    );
    expect(bounced).toMatchObject({ ok: false, error: "no_verificado" });
    expect(await prisma.computer.findUnique({ where: { clientId: organization.id } })).toBeNull();
    await new Promise<void>((resolve, reject) => redirector.close((error) => (error ? reject(error) : resolve())));

    const env = { token, machineId };
    const seen: { authorization: string; machineId: string; path: string }[] = [];
    const worker = await listen(env, seen);
    const enrolled = await enrollComputerLease(
      { organizationId: organization.id, machineId, endpoint: worker.origin, token },
      process.env,
      { allowLoopback: true },
    );
    expect(enrolled.ok).toBe(true);
    const kept = await rotateComputerLease(organization.id, `nuevo-${randomBytes(18).toString("hex")}`, process.env, { allowLoopback: true });
    expect(kept).toMatchObject({ ok: false, error: "no_verificado" });
    const still = await loadTenantLease(organization.id, process.env, { allowLoopback: true });
    expect(still.state).toBe("listo");
    if (still.state === "listo") expect(still.lease.token).toBe(token);
    await new Promise<void>((resolve, reject) => worker.server.close((error) => (error ? reject(error) : resolve())));
    delete process.env.CREDENTIALS_MASTER_KEY;
  });
});
