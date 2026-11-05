import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { decryptSecret, encryptSecret, readMasterKey, VaultKeyError } from "@/lib/credentials/crypto";
import { logVault, redactText } from "@/lib/credentials/redact";
import { clientAskedForLogin } from "@/lib/credentials/policy";
import {
  confirmRisk,
  createCredential,
  decryptForFill,
  deleteCredential,
  issueFillGrant,
  listAudit,
  listCredentials,
  prepareCredentialUse,
  redeemFillGrant,
} from "@/lib/credentials/service";
import {
  publicAuditJson,
  publicCredentialJson,
  PUBLIC_CREDENTIAL_KEYS,
  type AuditEvent,
  type Confirmation,
  type CredentialRepo,
  type FillGrant,
  type NewAudit,
  type StoredCredential,
} from "@/lib/credentials/types";

const SECRET = "ZzVaultSecret99";
const USERNAME = "user-sii-9988";
const ORG = "org_cliente_1";
const OTHER = "org_cliente_2";
const ACTOR = "user_dueno_1";

const FORBIDDEN = new Set(["ciphertext", "iv", "authTag", "secret", "password", "username", "fillGrant", "grant"]);

function key() {
  return randomBytes(32).toString("base64");
}

function env(master = key()) {
  return { CREDENTIALS_MASTER_KEY: master };
}

function forbiddenKeys(value: unknown, found: string[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) forbiddenKeys(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(name)) found.push(name);
      forbiddenKeys(item, found);
    }
  }
  return found;
}

function memoryRepo() {
  const credentials: StoredCredential[] = [];
  const audits: AuditEvent[] = [];
  const confirmations: Confirmation[] = [];
  const grants: FillGrant[] = [];
  let n = 0;
  const nid = (prefix: string) => {
    n += 1;
    return `${prefix}${String(n).padStart(10, "0")}`;
  };
  const stamp = (audit: NewAudit, credentialId: string, credentialLabel: string): AuditEvent => ({
    id: nid("audt"),
    organizationId: audit.organizationId,
    credentialId: audit.credentialId || credentialId,
    credentialLabel: audit.credentialLabel || credentialLabel,
    actorUserId: audit.actorUserId,
    kind: audit.kind,
    purpose: audit.purpose,
    success: audit.success,
    createdAt: new Date(),
  });
  const repo: CredentialRepo = {
    async insert(data, audit) {
      const row: StoredCredential = {
        ...data,
        id: nid("cred"),
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsedAt: null,
      };
      credentials.push(row);
      audits.push(stamp(audit, row.id, row.label));
      return row;
    },
    async list(organizationId) {
      return credentials.filter((row) => row.organizationId === organizationId);
    },
    async find(organizationId, id) {
      return credentials.find((row) => row.organizationId === organizationId && row.id === id) ?? null;
    },
    async remove(organizationId, id, audit) {
      const index = credentials.findIndex((row) => row.organizationId === organizationId && row.id === id);
      if (index < 0) return false;
      const [row] = credentials.splice(index, 1);
      audits.push(stamp(audit, row.id, row.label));
      return true;
    },
    async markUsed(organizationId, id, when, audit) {
      const row = credentials.find((item) => item.organizationId === organizationId && item.id === id);
      if (row) row.lastUsedAt = when;
      audits.push(stamp(audit, id, audit.credentialLabel));
    },
    async addAudit(audit) {
      const row = stamp(audit, audit.credentialId, audit.credentialLabel);
      audits.push(row);
      return row;
    },
    async listAudit(organizationId, limit) {
      return audits.filter((row) => row.organizationId === organizationId).slice(-limit).reverse();
    },
    async addConfirmation(data) {
      const row: Confirmation = { ...data, id: nid("conf"), usedAt: null, createdAt: new Date() };
      confirmations.push(row);
      return row;
    },
    async consumeConfirmation(input) {
      const row = confirmations.find(
        (item) =>
          item.organizationId === input.organizationId &&
          item.actorUserId === input.actorUserId &&
          item.action === input.action &&
          !item.usedAt &&
          item.expiresAt.getTime() > input.now.getTime(),
      );
      if (!row) return null;
      row.usedAt = input.now;
      return row;
    },
    async addGrant(data) {
      const row: FillGrant = { ...data, id: nid("grnt"), usedAt: null, createdAt: new Date() };
      grants.push(row);
      return row;
    },
    async findGrant(tokenHash) {
      return grants.find((row) => row.tokenHash === tokenHash) ?? null;
    },
    async consumeGrant(tokenHash, now) {
      const row = grants.find((item) => item.tokenHash === tokenHash && !item.usedAt && item.expiresAt.getTime() > now.getTime());
      if (!row) return null;
      row.usedAt = now;
      return row;
    },
  };
  return { repo, credentials, audits };
}

async function save(repo: CredentialRepo, master: string, organizationId = ORG) {
  return createCredential(
    repo,
    {
      organizationId,
      actorUserId: ACTOR,
      label: "Clave SII",
      portal: "SII",
      username: USERNAME,
      secret: SECRET,
      consentAcceptedAt: true,
    },
    env(master),
    new Date("2026-11-05T12:00:00.000Z"),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CREDENTIALS_MASTER_KEY;
});

describe("cifrado de la bóveda", () => {
  test("AES-256-GCM vuelve al texto y cada cifrado usa otro IV", () => {
    const master = readMasterKey(env());
    const first = encryptSecret("clave de prueba", master);
    const second = encryptSecret("clave de prueba", master);
    expect(decryptSecret(first, master)).toBe("clave de prueba");
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe("clave de prueba");
  });

  test("sin llave, o con una llave que no son 32 bytes, se niega y no repite el valor", () => {
    expect(() => readMasterKey({})).toThrow(VaultKeyError);
    expect(() => readMasterKey({ CREDENTIALS_MASTER_KEY: "" })).toThrow(VaultKeyError);
    expect(() => readMasterKey({ CREDENTIALS_MASTER_KEY: "   " })).toThrow(VaultKeyError);
    expect(() => readMasterKey({ CREDENTIALS_MASTER_KEY: "no-es-una-llave" })).toThrow(VaultKeyError);
    const short = Buffer.alloc(16).toString("base64");
    try {
      readMasterKey({ CREDENTIALS_MASTER_KEY: short });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VaultKeyError);
      expect((error as Error).message).toBe("boveda_sin_clave");
      expect((error as Error).message).not.toContain(short);
    }
    const tagged = encryptSecret("hola", readMasterKey(env()));
    const broken = { ...tagged, authTag: Buffer.from("x".repeat(16)).toString("base64") };
    expect(() => decryptSecret(broken, readMasterKey(env(key())))).toThrow(/cifrado_invalido/);
  });
});

describe("altas, listado y consentimiento", () => {
  test("sin consentimiento no se escribe y la respuesta no trae el secreto", async () => {
    const { repo, credentials } = memoryRepo();
    const result = await createCredential(
      repo,
      {
        organizationId: ORG,
        actorUserId: ACTOR,
        label: "Banco",
        portal: "BancoEstado",
        username: USERNAME,
        secret: SECRET,
        consentAcceptedAt: false,
      },
      env(),
    );
    expect(result).toEqual({ ok: false, error: "boveda_consentimiento" });
    expect(credentials).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(USERNAME);
  });

  test("sin CREDENTIALS_MASTER_KEY no se guarda", async () => {
    const { repo, credentials } = memoryRepo();
    const result = await createCredential(
      repo,
      {
        organizationId: ORG,
        actorUserId: ACTOR,
        label: "Banco",
        portal: "BancoEstado",
        username: USERNAME,
        secret: SECRET,
        consentAcceptedAt: true,
      },
      {},
    );
    expect(result).toEqual({ ok: false, error: "boveda_sin_clave" });
    expect(credentials).toHaveLength(0);
  });

  test("el listado y la auditoría no incluyen cifrado ni secreto", async () => {
    const { repo, credentials } = memoryRepo();
    const master = key();
    const created = await save(repo, master);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(credentials[0]?.ciphertext).not.toContain(SECRET);
    expect(credentials[0]?.usernameHint).toBe("9988");
    expect(decryptSecret(credentials[0], readMasterKey(env(master)))).toContain(SECRET);

    const listed = await listCredentials(repo, ORG);
    const json = listed.map(publicCredentialJson);
    expect(Object.keys(json[0] ?? {}).sort()).toEqual([...PUBLIC_CREDENTIAL_KEYS].sort());
    expect(forbiddenKeys(json)).toEqual([]);
    expect(JSON.stringify(json)).not.toContain(SECRET);
    expect(JSON.stringify(json)).not.toContain(USERNAME);
    expect(JSON.stringify(json)).not.toContain(credentials[0]?.ciphertext ?? "no");

    const other = await listCredentials(repo, OTHER);
    expect(other).toEqual([]);

    const audit = (await listAudit(repo, ORG)).map(publicAuditJson);
    expect(audit[0]?.kind).toBe("CREATE");
    expect(audit[0]?.credentialId).toBe(created.credential.id);
    expect(forbiddenKeys(audit)).toEqual([]);
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });
});

describe("uso y confirmación", () => {
  test("no descifra si el cliente no lo pidió, y un uso de riesgo exige confirmación", async () => {
    const { repo, audits } = memoryRepo();
    const master = key();
    const created = await save(repo, master);
    if (!created.ok) return;
    const denied = await decryptForFill(
      repo,
      {
        organizationId: ORG,
        credentialId: created.credential.id,
        actorUserId: ACTOR,
        purpose: "login",
        clientRequested: false,
      },
      env(master),
    );
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).not.toContain(SECRET);
    expect(audits.some((item) => item.kind === "USE" && item.success === false)).toBe(true);

    const risky = await decryptForFill(
      repo,
      {
        organizationId: ORG,
        credentialId: created.credential.id,
        actorUserId: ACTOR,
        purpose: "pagar",
        clientRequested: true,
      },
      env(master),
    );
    expect(risky).toEqual({ ok: false, error: "boveda_confirmacion" });
    expect(JSON.stringify(risky)).not.toContain(SECRET);

    const now = new Date("2026-11-05T15:00:00.000Z");
    const confirmed = await confirmRisk(repo, { organizationId: ORG, actorUserId: ACTOR, action: "PAGAR" }, now);
    expect(confirmed.ok).toBe(true);
    const opened = await decryptForFill(
      repo,
      {
        organizationId: ORG,
        credentialId: created.credential.id,
        actorUserId: ACTOR,
        purpose: "pagar",
        clientRequested: true,
      },
      env(master),
      new Date(now.getTime() + 60_000),
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.secret).toBe(SECRET);
    expect(opened.meta.usernameHint).toBe("9988");
    expect(JSON.stringify(opened.meta)).not.toContain(SECRET);

    const again = await decryptForFill(
      repo,
      {
        organizationId: ORG,
        credentialId: created.credential.id,
        actorUserId: ACTOR,
        purpose: "pagar",
        clientRequested: true,
      },
      env(master),
      new Date(now.getTime() + 120_000),
    );
    expect(again.ok).toBe(false);

    const foreign = await decryptForFill(
      repo,
      {
        organizationId: OTHER,
        credentialId: created.credential.id,
        actorUserId: ACTOR,
        purpose: "login",
        clientRequested: true,
      },
      env(master),
    );
    expect(foreign).toEqual({ ok: false, error: "noencontrado" });
  });

  test("el permiso de relleno es de un solo uso y no sale en el listado", async () => {
    const { repo } = memoryRepo();
    const master = key();
    const created = await save(repo, master);
    if (!created.ok) return;
    const now = new Date("2026-11-05T16:00:00.000Z");
    const grant = await issueFillGrant(
      repo,
      { organizationId: ORG, actorUserId: ACTOR, credentialIds: [created.credential.id], clientRequested: true },
      now,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;
    const opened = await redeemFillGrant(repo, { grant: grant.token, credentialId: created.credential.id }, env(master), now);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.secret).toBe(SECRET);
    const second = await redeemFillGrant(repo, { grant: grant.token, credentialId: created.credential.id }, env(master), now);
    expect(second).toEqual({ ok: false, error: "no_autorizado" });
    expect(JSON.stringify(await listCredentials(repo, ORG))).not.toContain(grant.token);
    expect(JSON.stringify(await listCredentials(repo, ORG))).not.toContain(SECRET);

    const removed = await deleteCredential(repo, { organizationId: ORG, actorUserId: ACTOR, credentialId: created.credential.id });
    expect(removed).toEqual({ ok: true });
    expect(await listCredentials(repo, ORG)).toEqual([]);
    const audit = await listAudit(repo, ORG);
    expect(audit.some((item) => item.kind === "DELETE" && item.credentialLabel === "Clave SII")).toBe(true);
    expect(JSON.stringify(audit.map(publicAuditJson))).not.toContain(SECRET);
  });

  test("la tarea solo adjunta metadatos cuando el cliente pide el ingreso", async () => {
    const { repo } = memoryRepo();
    const master = key();
    const created = await save(repo, master);
    if (!created.ok) return;
    expect(clientAskedForLogin("Abre https://example.com")).toBe(false);
    const plain = await prepareCredentialUse(repo, { organizationId: ORG, actorUserId: ACTOR, goal: "Abre https://example.com" }, env(master));
    expect(plain).toEqual({ ok: true });

    const login = await prepareCredentialUse(
      repo,
      { organizationId: ORG, actorUserId: ACTOR, goal: "Entra al SII con mi clave de la bóveda" },
      env(master),
    );
    expect(login.ok).toBe(true);
    if (!login.ok || !login.agentPayload) return;
    const packed = JSON.stringify(login.agentPayload);
    expect(login.agentPayload.credentials).toEqual([
      { id: created.credential.id, label: "Clave SII", portal: "SII", usernameHint: "9988" },
    ]);
    expect(packed).not.toContain(SECRET);
    expect(packed).not.toContain(USERNAME);
    expect(packed).not.toContain("ciphertext");
    expect("clientConfirmed" in login.agentPayload).toBe(false);

    const risk = await prepareCredentialUse(
      repo,
      { organizationId: ORG, actorUserId: ACTOR, goal: "Entra al SII y presenta la declaración de IVA", credentialId: created.credential.id },
      env(master),
    );
    expect(risk).toEqual({ ok: true });
  });
});

describe("redacción de logs", () => {
  test("un log no conserva la clave ni la llave maestra", () => {
    const master = key();
    process.env.CREDENTIALS_MASTER_KEY = master;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logVault("boveda_prueba", { ok: false, error: `falló ${SECRET}`, secret: SECRET, credentialId: "cred0000000001" }, [SECRET]);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("[redactado]");
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain(master);
    expect(line).not.toContain("secret");
    expect(redactText(`la clave es ${SECRET}`, [SECRET])).toBe("la clave es [redactado]");
  });
});
