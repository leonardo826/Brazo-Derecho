import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { computerTokenAad } from "@/lib/computer/lease";
import { qaEnrollConfigured, qaEnrollLogLine } from "@/lib/computer/qa-enroll-gate";
import { runQaEnroll, type QaComputerRow, type QaEnrollStore } from "@/lib/computer/qa-enroll";
import { decryptSecret } from "@/lib/credentials/crypto";

const KEY = Buffer.alloc(32, 11).toString("base64");
const TOKEN_A = "token-a-qa-enroll-0001-aaaa";
const TOKEN_B = "token-b-qa-enroll-0002-bbbb";
const TOKEN_C = "token-c-qa-enroll-0003-cccc";
const HOST_A = "64-176-27-253.sslip.io";
const HOST_B = "64-176-26-74.sslip.io";
const HOST_C = "64-176-28-67.sslip.io";

const spec = {
  A: { orgId: "org-qa-a", endpoint: `https://${HOST_A}`, machineName: "maq-org-a" },
  B: { orgId: "org-qa-b", endpoint: `https://${HOST_B}`, machineName: "maq-org-b" },
  C: { orgId: "org-qa-c", endpoint: `https://${HOST_C}`, machineName: "maq-org-c" },
};

function env(extra: Record<string, string> = {}) {
  return {
    CREDENTIALS_MASTER_KEY: KEY,
    QA_ENROLL_SPEC: JSON.stringify(spec),
    QA_ENROLL_TOKEN_A: TOKEN_A,
    QA_ENROLL_TOKEN_B: TOKEN_B,
    QA_ENROLL_TOKEN_C: TOKEN_C,
    ...extra,
  };
}

function memory() {
  const rows = new Map<string, QaComputerRow>();
  const qa = new Set<string>();
  const marked: string[] = [];
  let inserts = 0;
  const store: QaEnrollStore = {
    async findByOrg(orgId) {
      const row = rows.get(orgId);
      return row ? { ...row } : null;
    },
    async machineOwner(machineId) {
      for (const row of rows.values()) {
        if (row.machineId === machineId) return row.clientId;
      }
      return null;
    },
    async markQa(orgId) {
      marked.push(orgId);
      qa.add(orgId);
    },
    async insert(row) {
      inserts += 1;
      if (rows.has(row.clientId)) return "duplicado";
      rows.set(row.clientId, { ...row });
      return "ok";
    },
  };
  return {
    store,
    rows,
    inserts: () => inserts,
    qa: () => [...qa].sort(),
    marked: () => [...marked],
  };
}

const lookup = vi.fn(async (hostname: string) => {
  const pin = hostname.startsWith("64-176-") ? hostname.slice(0, hostname.indexOf(".sslip.io")) : "93.184.216.34";
  return [{ address: pin, family: 4 }];
});

function secrets() {
  return [TOKEN_A, TOKEN_B, TOKEN_C, KEY, HOST_A, HOST_B, HOST_C, "maq-org-a", "maq-org-b", "maq-org-c"];
}

function runCli(env: Record<string, string> = {}) {
  return spawnSync("./node_modules/.bin/tsx", ["scripts/qa-enroll.ts"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env },
  });
}

describe("alta de un solo uso", () => {
  test("el comando sin variables no escribe y no falla el build", () => {
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("el comando con un token suelto falla sin imprimirlo", () => {
    const token = "token-cli-no-imprimir-0001";
    const result = runCli({ QA_ENROLL_TOKEN_A: token });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("qa-enroll orgId=- ERROR\n");
    expect(result.stdout).not.toContain(token);
    expect(result.stderr).not.toContain(token);
  });

  test("sin variables no hace nada", async () => {
    expect(qaEnrollConfigured({})).toBe("skip");
    const db = memory();
    const lines: string[] = [];
    const code = await runQaEnroll({}, { store: db.store, log: (line) => lines.push(line) });
    expect(code).toBe(0);
    expect(lines).toEqual([]);
    expect(db.inserts()).toBe(0);
  });

  test("es idempotente y no filtra secretos al log", async () => {
    const db = memory();
    const lines: string[] = [];
    const first = await runQaEnroll(env(), {
      store: db.store,
      lookupImpl: lookup,
      log: (line) => lines.push(line),
    });
    expect(first).toBe(0);
    expect(db.inserts()).toBe(3);
    expect(db.qa()).toEqual(["org-qa-a", "org-qa-b", "org-qa-c"]);
    expect(lines).toEqual([
      qaEnrollLogLine("org-qa-a", true),
      qaEnrollLogLine("org-qa-b", true),
      qaEnrollLogLine("org-qa-c", true),
    ]);
    const saved = db.rows.get("org-qa-a");
    expect(saved?.leaseEpoch).toBe(1);
    expect(saved?.agentEndpoint).toBe(`https://${HOST_A}`);
    expect(
      decryptSecret(
        { ciphertext: saved?.agentTokenCiphertext ?? "", iv: saved?.agentTokenIv ?? "", authTag: saved?.agentTokenAuthTag ?? "" },
        Buffer.from(KEY, "base64"),
        computerTokenAad("org-qa-a", "maq-org-a"),
      ),
    ).toBe(TOKEN_A);
    const again = await runQaEnroll(env(), {
      store: db.store,
      lookupImpl: lookup,
      log: (line) => lines.push(line),
    });
    expect(again).toBe(0);
    expect(db.inserts()).toBe(3);
    expect(db.qa()).toEqual(["org-qa-a", "org-qa-b", "org-qa-c"]);
    expect(db.marked()).toEqual(["org-qa-a", "org-qa-b", "org-qa-c", "org-qa-a", "org-qa-b", "org-qa-c"]);
    const joined = lines.join("\n");
    for (const secret of secrets()) expect(joined).not.toContain(secret);
    for (const line of lines) expect(line).toMatch(/^qa-enroll orgId=[A-Za-z0-9_-]{4,80} OK$/);
    const build = readFileSync("vercel.json", "utf8");
    expect(build).toContain("scripts/qa-enroll.ts");
    expect(readFileSync("package.json", "utf8")).toContain("scripts/qa-enroll.ts");
  });

  test("un endpoint privado o variables a medias no guardan y no escriben el secreto", async () => {
    const db = memory();
    const lines: string[] = [];
    const leaked = "token-privado-no-imprimir-9999";
    const host = "secreto-no-log.example";
    const partial = await runQaEnroll({ QA_ENROLL_TOKEN_A: leaked }, { store: db.store, log: (line) => lines.push(line) });
    expect(partial).toBe(1);
    expect(qaEnrollConfigured({ QA_ENROLL_TOKEN_A: leaked })).toBe("partial");
    expect(db.inserts()).toBe(0);
    const bad = {
      ...spec,
      A: { ...spec.A, endpoint: `https://${host}` },
    };
    const code = await runQaEnroll(env({ QA_ENROLL_SPEC: JSON.stringify(bad), QA_ENROLL_TOKEN_A: leaked }), {
      store: db.store,
      lookupImpl: async (hostname: string) => [
        { address: hostname === host ? "10.0.0.8" : "93.184.216.34", family: 4 },
      ],
      log: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(db.rows.has("org-qa-a")).toBe(false);
    expect(db.rows.has("org-qa-b")).toBe(true);
    const text = lines.join("\n");
    expect(text).not.toContain(leaked);
    expect(text).not.toContain(host);
    expect(text).not.toContain("10.0.0.8");
    expect(text).not.toContain(KEY);
    expect(text).toContain(qaEnrollLogLine("-", false));
    expect(text).toContain(qaEnrollLogLine("org-qa-a", false));
    expect(text).toContain(qaEnrollLogLine("org-qa-b", true));
    expect(db.qa()).toEqual(["org-qa-a", "org-qa-b", "org-qa-c"]);
  });

  test("un DNS que no resuelve anota ERROR y no tumba el deploy", async () => {
    const db = memory();
    const lines: string[] = [];
    const host = "dns-roto-no-log.example";
    const bad = { ...spec, A: { ...spec.A, endpoint: `https://${host}` } };
    const code = await runQaEnroll(env({ QA_ENROLL_SPEC: JSON.stringify(bad) }), {
      store: db.store,
      lookupImpl: async (hostname) => {
        if (hostname === host) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
        return [{ address: "93.184.216.34", family: 4 }];
      },
      log: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(db.rows.has("org-qa-a")).toBe(false);
    expect(db.rows.has("org-qa-b")).toBe(true);
    expect(db.rows.has("org-qa-c")).toBe(true);
    expect(db.qa()).toEqual(["org-qa-a", "org-qa-b", "org-qa-c"]);
    expect(db.qa()).not.toContain("org-otra");
    const text = lines.join("\n");
    expect(text).toContain(qaEnrollLogLine("org-qa-a", false));
    expect(text).toContain(qaEnrollLogLine("org-qa-b", true));
    expect(text).toContain(qaEnrollLogLine("org-qa-c", true));
    expect(text).not.toContain(host);
    expect(text).not.toContain("ENOTFOUND");
    expect(text).not.toContain(TOKEN_A);
    expect(text).not.toContain(KEY);
  });
});
