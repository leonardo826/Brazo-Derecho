import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, readMasterKey, VaultKeyError, type VaultEnv } from "@/lib/credentials/crypto";
import { logVault } from "@/lib/credentials/redact";
import {
  clientAskedForLogin,
  explicitVaultAsk,
  isHighRiskGoal,
  isHighRiskPurpose,
  metadataForModel,
  riskActionOf,
} from "@/lib/credentials/policy";
import {
  CONFIRMATION_TTL_MS,
  CREDENTIAL_LIMIT,
  GRANT_TTL_MS,
  toPublicCredential,
  usernameHintFrom,
  type AuditKind,
  type CredentialMeta,
  type CredentialRepo,
  type PublicCredential,
  type RiskAction,
} from "@/lib/credentials/types";

export type VaultFailure = { ok: false; error: string };

export type SecretMaterial = { username: string; secret: string };

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function cleanLabel(value: string, max: number) {
  const text = clip(value, max);
  if (!text || text.length < 2) return "";
  if (/[\u0000-\u001F\u007F]/.test(text)) return "";
  return text;
}

function sealPayload(material: SecretMaterial) {
  return JSON.stringify({ v: 1, username: material.username, secret: material.secret });
}

function openPayload(plaintext: string): SecretMaterial | null {
  try {
    const parsed = JSON.parse(plaintext) as { v?: unknown; username?: unknown; secret?: unknown };
    if (parsed.v !== 1 || typeof parsed.username !== "string" || typeof parsed.secret !== "string") return null;
    if (!parsed.username || !parsed.secret) return null;
    return { username: parsed.username, secret: parsed.secret };
  } catch {
    return null;
  }
}

function keyOrNull(env: VaultEnv) {
  try {
    return readMasterKey(env);
  } catch (error) {
    if (error instanceof VaultKeyError) return null;
    return null;
  }
}

export function consentGiven(value: unknown) {
  return value === true;
}

export async function createCredential(
  repo: CredentialRepo,
  input: {
    organizationId: string;
    actorUserId: string;
    label: string;
    portal: string;
    username: string;
    secret: string;
    consentAcceptedAt: unknown;
  },
  env: VaultEnv,
  now = new Date(),
): Promise<{ ok: true; credential: PublicCredential } | VaultFailure> {
  if (!consentGiven(input.consentAcceptedAt)) {
    return { ok: false, error: "boveda_consentimiento" };
  }
  const label = cleanLabel(input.label, 80);
  const portal = cleanLabel(input.portal, 120);
  const username = input.username.trim();
  const secret = input.secret;
  if (!label || !portal || username.length < 1 || username.length > 160 || secret.length < 4 || secret.length > 400) {
    return { ok: false, error: "datos" };
  }
  if (/[\u0000-\u001F\u007F]/.test(username) || secret.includes("\0")) {
    return { ok: false, error: "datos" };
  }
  const existing = await repo.list(input.organizationId);
  if (existing.length >= CREDENTIAL_LIMIT) return { ok: false, error: "cupo" };
  const key = keyOrNull(env);
  if (!key) {
    logVault("boveda_alta", { ok: false, error: "boveda_sin_clave" });
    return { ok: false, error: "boveda_sin_clave" };
  }
  const sealed = encryptSecret(sealPayload({ username, secret }), key);
  const row = await repo.insert(
    {
      organizationId: input.organizationId,
      label,
      portal,
      usernameHint: usernameHintFrom(username),
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      consentAcceptedAt: now,
      createdByUserId: input.actorUserId,
    },
    {
      organizationId: input.organizationId,
      credentialId: "",
      credentialLabel: label,
      actorUserId: input.actorUserId,
      kind: "CREATE",
      purpose: "alta",
      success: true,
    },
  );
  logVault("boveda_alta", { ok: true, credentialId: row.id });
  return { ok: true, credential: toPublicCredential(row) };
}

export async function listCredentials(repo: CredentialRepo, organizationId: string) {
  const rows = await repo.list(organizationId);
  return rows.map(toPublicCredential);
}

export async function listAudit(repo: CredentialRepo, organizationId: string) {
  return repo.listAudit(organizationId, 50);
}

export async function deleteCredential(
  repo: CredentialRepo,
  input: { organizationId: string; actorUserId: string; credentialId: string },
): Promise<{ ok: true } | VaultFailure> {
  if (!ID_RE.test(input.credentialId)) return { ok: false, error: "noencontrado" };
  const row = await repo.find(input.organizationId, input.credentialId);
  if (!row) return { ok: false, error: "noencontrado" };
  const deleted = await repo.remove(input.organizationId, input.credentialId, {
    organizationId: input.organizationId,
    credentialId: row.id,
    credentialLabel: row.label,
    actorUserId: input.actorUserId,
    kind: "DELETE",
    purpose: "eliminar",
    success: true,
  });
  if (!deleted) return { ok: false, error: "noencontrado" };
  logVault("boveda_baja", { ok: true, credentialId: row.id });
  return { ok: true };
}

async function auditUse(
  repo: CredentialRepo,
  input: {
    organizationId: string;
    credentialId: string;
    credentialLabel: string;
    actorUserId: string;
    purpose: string;
    success: boolean;
    kind?: AuditKind;
  },
) {
  await repo.addAudit({
    organizationId: input.organizationId,
    credentialId: input.credentialId,
    credentialLabel: input.credentialLabel,
    actorUserId: input.actorUserId,
    kind: input.kind ?? "USE",
    purpose: input.purpose.slice(0, 160),
    success: input.success,
  });
}

export async function decryptForFill(
  repo: CredentialRepo,
  input: {
    organizationId: string;
    credentialId: string;
    actorUserId: string;
    purpose: string;
    clientRequested: boolean;
  },
  env: VaultEnv,
  now = new Date(),
): Promise<{ ok: true; username: string; secret: string; meta: PublicCredential } | VaultFailure> {
  const purpose = input.purpose.slice(0, 160) || "login";
  const fail = async (error: string, label = "desconocida") => {
    if (input.organizationId && input.credentialId) {
      await auditUse(repo, {
        organizationId: input.organizationId,
        credentialId: input.credentialId,
        credentialLabel: label,
        actorUserId: input.actorUserId,
        purpose,
        success: false,
      });
    }
    logVault("boveda_uso", { ok: false, error, credentialId: input.credentialId }, []);
    return { ok: false as const, error };
  };

  if (input.clientRequested !== true) return fail("no_pedido");
  if (!ID_RE.test(input.credentialId)) return fail("noencontrado");

  const key = keyOrNull(env);
  if (!key) return fail("boveda_sin_clave");

  const row = await repo.find(input.organizationId, input.credentialId);
  if (!row) return fail("noencontrado");

  if (isHighRiskPurpose(purpose)) {
    const action = riskActionOf(purpose);
    if (!action) return fail("boveda_confirmacion", row.label);
    const confirmation = await repo.consumeConfirmation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action,
      now,
    });
    if (!confirmation) return fail("boveda_confirmacion", row.label);
  }

  let material: SecretMaterial | null = null;
  try {
    material = openPayload(decryptSecret(row, key));
  } catch {
    material = null;
  }
  if (!material) return fail("cifrado", row.label);

  await repo.markUsed(input.organizationId, row.id, now, {
    organizationId: input.organizationId,
    credentialId: row.id,
    credentialLabel: row.label,
    actorUserId: input.actorUserId,
    kind: "USE",
    purpose,
    success: true,
  });
  logVault("boveda_uso", { ok: true, credentialId: row.id });
  return { ok: true, username: material.username, secret: material.secret, meta: toPublicCredential({ ...row, lastUsedAt: now }) };
}

export async function confirmRisk(
  repo: CredentialRepo,
  input: { organizationId: string; actorUserId: string; action: unknown },
  now = new Date(),
): Promise<{ ok: true; action: RiskAction; expiresAt: Date } | VaultFailure> {
  const action = input.action === "DECLARAR" || input.action === "declarar" ? "DECLARAR" : input.action === "PAGAR" || input.action === "pagar" ? "PAGAR" : null;
  if (!action) return { ok: false, error: "datos" };
  const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
  const row = await repo.addConfirmation({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action,
    expiresAt,
  });
  await repo.addAudit({
    organizationId: input.organizationId,
    credentialId: "",
    credentialLabel: action === "DECLARAR" ? "Declaración" : "Pago",
    actorUserId: input.actorUserId,
    kind: "CONFIRM",
    purpose: action === "DECLARAR" ? "declarar" : "pagar",
    success: true,
  });
  logVault("boveda_confirmacion", { ok: true, purpose: action === "DECLARAR" ? "declarar" : "pagar" });
  return { ok: true, action: row.action, expiresAt: row.expiresAt };
}

function grantHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueFillGrant(
  repo: CredentialRepo,
  input: {
    organizationId: string;
    actorUserId: string;
    credentialIds: string[];
    clientRequested: boolean;
    purpose?: string;
  },
  now = new Date(),
): Promise<{ ok: true; token: string; expiresAt: Date } | VaultFailure> {
  if (input.clientRequested !== true) return { ok: false, error: "no_pedido" };
  const purpose = (input.purpose ?? "login").slice(0, 160);
  if (isHighRiskPurpose(purpose)) return { ok: false, error: "boveda_confirmacion" };
  const ids = [...new Set(input.credentialIds.filter((id) => ID_RE.test(id)))].slice(0, 20);
  if (!ids.length) return { ok: false, error: "noencontrado" };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
  await repo.addGrant({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    tokenHash: grantHash(token),
    allowedCredentialIds: ids,
    purpose,
    highRisk: false,
    expiresAt,
  });
  return { ok: true, token, expiresAt };
}

export async function redeemFillGrant(
  repo: CredentialRepo,
  input: {
    grant: string;
    credentialId: string;
    isOrganizationActive?: (organizationId: string) => Promise<boolean>;
  },
  env: VaultEnv,
  now = new Date(),
): Promise<{ ok: true; username: string; secret: string } | VaultFailure> {
  const grant = input.grant.trim();
  if (grant.length < 20 || !ID_RE.test(input.credentialId)) {
    logVault("boveda_relleno", { ok: false, error: "no_autorizado" });
    return { ok: false, error: "no_autorizado" };
  }
  const found = await repo.findGrant(grantHash(grant));
  if (!found || found.usedAt || found.expiresAt.getTime() <= now.getTime()) {
    logVault("boveda_relleno", { ok: false, error: "no_autorizado" });
    return { ok: false, error: "no_autorizado" };
  }
  if (input.isOrganizationActive && !(await input.isOrganizationActive(found.organizationId))) {
    logVault("boveda_relleno", { ok: false, error: "suspendida", credentialId: input.credentialId });
    return { ok: false, error: "suspendida" };
  }
  const consumed = await repo.consumeGrant(found.tokenHash, now);
  if (!consumed) {
    logVault("boveda_relleno", { ok: false, error: "no_autorizado" });
    return { ok: false, error: "no_autorizado" };
  }
  if (!consumed.allowedCredentialIds.includes(input.credentialId) || consumed.highRisk || isHighRiskPurpose(consumed.purpose)) {
    await auditUse(repo, {
      organizationId: consumed.organizationId,
      credentialId: input.credentialId,
      credentialLabel: "desconocida",
      actorUserId: consumed.actorUserId,
      purpose: "login",
      success: false,
    });
    logVault("boveda_relleno", { ok: false, error: "no_autorizado", credentialId: input.credentialId });
    return { ok: false, error: "no_autorizado" };
  }
  const opened = await decryptForFill(
    repo,
    {
      organizationId: consumed.organizationId,
      credentialId: input.credentialId,
      actorUserId: consumed.actorUserId,
      purpose: "login",
      clientRequested: true,
    },
    env,
    now,
  );
  if (!opened.ok) return { ok: false, error: opened.error === "noencontrado" ? "no_autorizado" : opened.error };
  return { ok: true, username: opened.username, secret: opened.secret };
}

function selectMetadata(rows: PublicCredential[], goal: string, credentialId?: string): CredentialMeta[] {
  if (credentialId) return metadataForModel(rows.filter((row) => row.id === credentialId));
  const text = goal.toLowerCase();
  const matched = rows.filter((row) => text.includes(row.label.toLowerCase()) || text.includes(row.portal.toLowerCase()));
  return metadataForModel(matched.length ? matched : rows);
}

export async function prepareCredentialUse(
  repo: CredentialRepo,
  input: {
    organizationId: string;
    actorUserId: string;
    goal: string;
    credentialId?: string;
  },
  env: VaultEnv,
  now = new Date(),
): Promise<{ ok: true; agentPayload?: { credentials: CredentialMeta[]; fillGrant: string } } | VaultFailure> {
  const credentialId = input.credentialId?.trim() || undefined;
  const asked = clientAskedForLogin(input.goal) || Boolean(credentialId);
  if (!asked) return { ok: true };
  if (isHighRiskGoal(input.goal)) return { ok: true };
  if (credentialId && !ID_RE.test(credentialId)) return { ok: false, error: "noencontrado" };
  const rows = (await repo.list(input.organizationId)).map(toPublicCredential);
  const metadata = selectMetadata(rows, input.goal, credentialId);
  if (credentialId && !metadata.length) return { ok: false, error: "noencontrado" };
  if (!metadata.length) return { ok: true };
  if (explicitVaultAsk(input.goal, credentialId) && !keyOrNull(env)) {
    logVault("boveda_tarea", { ok: false, error: "boveda_sin_clave" });
    return { ok: false, error: "boveda_sin_clave" };
  }
  if (!keyOrNull(env)) return { ok: true };
  const grant = await issueFillGrant(
    repo,
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      credentialIds: metadata.map((row) => row.id),
      clientRequested: true,
      purpose: "login",
    },
    now,
  );
  if (!grant.ok) return grant;
  return { ok: true, agentPayload: { credentials: metadata, fillGrant: grant.token } };
}
