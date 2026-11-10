import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { handleAgent } from "../../agent-runtime/src/http";
import type { Desktop, DesktopStatus } from "../../agent-runtime/src/desktop";
import { loadTenantLease } from "@/lib/computer/lease";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

function desktop(): Desktop {
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

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsxCli = join(dirname(createRequire(import.meta.url).resolve("tsx/package.json")), "dist/cli.mjs");

function cli(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, "scripts/computer-lease-admin.ts", ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.on("error", reject);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.end();
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("comando de operador, cableado local", () => {
  test("registra, consulta, despacha, cancela y la revocación rechaza el siguiente despacho", async () => {
    const master = randomBytes(32).toString("base64");
    const token = `lease-${randomBytes(18).toString("hex")}`;
    const machineId = `mach-${randomBytes(4).toString("hex")}`;
    const seen: string[] = [];
    const server = http.createServer(async (req, res) => {
      seen.push(req.url ?? "");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const response = await handleAgent(
        {
          method: req.method ?? "GET",
          path: req.url ?? "/",
          body: raw ? (JSON.parse(raw) as object) : undefined,
          headers: { authorization: req.headers.authorization },
        },
        { env: { AGENT_RUNTIME_TOKEN: token, MACHINE_ID: machineId, XAI_MODE: "mock" }, desktop: desktop() },
      );
      res.writeHead(response.status);
      res.end(response.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const user = await prisma.user.create({
      data: {
        email: `op-${Date.now()}@test.local`,
        name: "Op",
        passwordHash: await hashPassword("Clave-demo-2026"),
      },
    });
    createdUsers.push(user.id);
    const organization = await prisma.organization.create({
      data: { name: "QA", slug: `qa-${Date.now()}-${randomBytes(2).toString("hex")}`, isQa: true },
    });
    createdOrgs.push(organization.id);
    const env = { CREDENTIALS_MASTER_KEY: master, COMPUTER_LEASE_TOKEN: token };
    const common = ["--operator", "qa-operator", "--client", organization.id, "--machine", machineId];
    const enrolled = await cli(["harness-enroll", ...common, "--attest-ownership", "--endpoint", `http://127.0.0.1:${port}`], env);
    expect(enrolled.code).toBe(0);
    expect(enrolled.stdout).not.toContain(token);
    expect(enrolled.stderr).not.toContain(token);
    expect(enrolled.stdout).toContain("\"outcome\":\"ok\"");
    expect((await loadTenantLease(organization.id)).state).toBe("transporte");

    const status = await cli(["harness-status", ...common], env);
    expect(status.code).toBe(0);
    expect(status.stdout).not.toContain(token);
    expect(seen).toContain("/status");

    const dispatched = await cli(["harness-dispatch", ...common, "--goal", "estado del cable"], env);
    expect(dispatched.code).toBe(0);
    expect(dispatched.stdout).toContain("\"outcome\":\"no-real\"");
    expect(dispatched.stdout).not.toContain(token);
    expect(seen).toContain("/task");

    const cancelled = await cli(["harness-cancel", ...common], env);
    expect(cancelled.code).toBe(0);
    expect(cancelled.stdout).not.toContain(token);
    expect(seen).toContain("/task/cancel");

    const revoked = await cli(["revoke", ...common], env);
    expect(revoked.code).toBe(0);
    const after = await cli(["harness-dispatch", ...common, "--goal", "estado del cable"], env);
    expect(after.code).toBe(1);
    expect(after.stdout).toContain("\"outcome\":\"rechazado\"");
    expect(seen.filter((path) => path === "/task")).toHaveLength(1);

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }, 30_000);
});
