import { lookup } from "node:dns/promises";
import { Prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, readMasterKey, type VaultEnv } from "@/lib/credentials/crypto";
import { usableLease, type LeaseState } from "@/lib/chat/desktop-task";
import { prisma } from "@/lib/prisma";

const AAD_VERSION = "v1";

export type LeaseInput = {
  organizationId: string;
  machineId: string;
  endpoint: string;
  token: string;
};

export type EnrollOptions = {
  /** Solo el proceso de prueba puede pasar true. No depende de NODE_ENV. */
  allowLoopback?: boolean;
  lookupImpl?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  fetchImpl?: typeof fetch;
};

function aad(organizationId: string, machineId: string) {
  return `${AAD_VERSION}\n${organizationId}\n${machineId}`;
}

function bareHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function privateAddress(address: string) {
  const host = bareHost(address);
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped?.[1] ?? host;
  if (v4.includes(":")) {
    const head = v4.split(":")[0] ?? "";
    return head.startsWith("fc") || head.startsWith("fd") || head.startsWith("fe80") || head === "";
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function endpointAllowed(raw: string, options: EnrollOptions = {}) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = bareHost(url.hostname);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return null;
  }
  if (host === "127.0.0.1") {
    if (options.allowLoopback !== true || url.protocol !== "http:") return null;
    return url.origin;
  }
  if (url.protocol !== "https:") return null;
  if (privateAddress(host)) return null;
  try {
    const records = await (options.lookupImpl ?? ((hostname) => lookup(hostname, { all: true, verbatim: true })))(host);
    if (records.length === 0 || records.some((record) => privateAddress(record.address) || record.address === "::1")) return null;
  } catch {
    return null;
  }
  return url.origin;
}

async function attestRuntime(origin: string, token: string, machineId: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${origin}/status`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(3_000),
  });
  if (response.status !== 200) return false;
  const data = (await response.json().catch(() => null)) as { ok?: unknown; machineId?: unknown } | null;
  return Boolean(data && data.ok === true && data.machineId === machineId);
}

function writeError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { ok: false as const, error: "maquina" as const };
  }
  throw error;
}

async function organizationOpen(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true },
  });
  return Boolean(organization && !organization.suspendedAt);
}

export async function enrollComputerLease(input: LeaseInput, env: VaultEnv = process.env, options: EnrollOptions = {}) {
  const token = input.token.trim();
  const machineId = input.machineId.trim();
  if (token.length < 16 || token.length > 200) return { ok: false as const, error: "datos" as const };
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(machineId)) return { ok: false as const, error: "datos" as const };
  if (!(await organizationOpen(input.organizationId))) return { ok: false as const, error: "suspendida" as const };
  const origin = await endpointAllowed(input.endpoint, options);
  if (!origin) return { ok: false as const, error: "datos" as const };
  const taken = await prisma.computer.findFirst({
    where: { machineId, NOT: { clientId: input.organizationId } },
    select: { id: true },
  });
  if (taken) return { ok: false as const, error: "maquina" as const };
  const fetchImpl = options.fetchImpl ?? fetch;
  let attested = false;
  try {
    attested = await attestRuntime(origin, token, machineId, fetchImpl);
  } catch {
    attested = false;
  }
  if (!attested) return { ok: false as const, error: "no_verificado" as const };
  let sealed;
  try {
    sealed = encryptSecret(token, readMasterKey(env), aad(input.organizationId, machineId));
  } catch {
    return { ok: false as const, error: "boveda_sin_clave" as const };
  }
  try {
    await prisma.computer.upsert({
      where: { clientId: input.organizationId },
      create: {
        clientId: input.organizationId,
        machineId,
        status: "RUNNING",
        agentEndpoint: origin,
        agentTokenCiphertext: sealed.ciphertext,
        agentTokenIv: sealed.iv,
        agentTokenAuthTag: sealed.authTag,
      },
      update: {
        machineId,
        status: "RUNNING",
        agentEndpoint: origin,
        agentTokenCiphertext: sealed.ciphertext,
        agentTokenIv: sealed.iv,
        agentTokenAuthTag: sealed.authTag,
      },
    });
  } catch (error) {
    return writeError(error);
  }
  return { ok: true as const, machineId, configured: true as const };
}

export async function revokeComputerLease(organizationId: string) {
  await prisma.computer.updateMany({
    where: { clientId: organizationId },
    data: {
      status: "STOPPED",
      agentEndpoint: "",
      agentTokenCiphertext: "",
      agentTokenIv: "",
      agentTokenAuthTag: "",
    },
  });
}

export async function rotateComputerLease(
  organizationId: string,
  token: string,
  env: VaultEnv = process.env,
  options: EnrollOptions = {},
) {
  const next = token.trim();
  if (next.length < 16 || next.length > 200) return { ok: false as const, error: "datos" as const };
  if (!(await organizationOpen(organizationId))) return { ok: false as const, error: "suspendida" as const };
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row || row.status !== "RUNNING" || !row.machineId || !row.agentEndpoint) {
    return { ok: false as const, error: "ausente" as const };
  }
  const origin = await endpointAllowed(row.agentEndpoint, options);
  if (!origin) return { ok: false as const, error: "datos" as const };
  let attested = false;
  try {
    attested = await attestRuntime(origin, next, row.machineId, options.fetchImpl ?? fetch);
  } catch {
    attested = false;
  }
  if (!attested) return { ok: false as const, error: "no_verificado" as const };
  let sealed;
  try {
    sealed = encryptSecret(next, readMasterKey(env), aad(organizationId, row.machineId));
  } catch {
    return { ok: false as const, error: "boveda_sin_clave" as const };
  }
  await prisma.computer.update({
    where: { clientId: organizationId },
    data: {
      agentTokenCiphertext: sealed.ciphertext,
      agentTokenIv: sealed.iv,
      agentTokenAuthTag: sealed.authTag,
    },
  });
  return { ok: true as const };
}

export async function loadTenantLease(
  organizationId: string,
  env: VaultEnv = process.env,
  options: EnrollOptions = {},
): Promise<LeaseState> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true },
  });
  if (!organization || organization.suspendedAt) return { state: "ausente" };
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row || row.status !== "RUNNING" || !row.machineId.trim() || !row.agentEndpoint.trim()) return { state: "ausente" };
  if (!row.agentTokenCiphertext || !row.agentTokenIv || !row.agentTokenAuthTag) return { state: "ausente" };
  let token = "";
  try {
    token = decryptSecret(
      { ciphertext: row.agentTokenCiphertext, iv: row.agentTokenIv, authTag: row.agentTokenAuthTag },
      readMasterKey(env),
      aad(organizationId, row.machineId),
    );
  } catch {
    return { state: "transporte" };
  }
  const usable = usableLease(
    { organizationId, machineId: row.machineId, baseUrl: row.agentEndpoint, token },
    organizationId,
    options.allowLoopback === true,
  );
  if (!usable) return { state: "transporte" };
  return { state: "listo", lease: usable };
}
