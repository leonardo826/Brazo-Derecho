import { lookup } from "node:dns/promises";
import { Prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, readMasterKey, type VaultEnv } from "@/lib/credentials/crypto";
import { usableLease, type LeaseState } from "@/lib/chat/desktop-task";
import { pinnedRequest } from "@/lib/computer/pinned-fetch";
import { prisma } from "@/lib/prisma";

const AAD_VERSION = "v1";

/** Marca que solo el comando local importa. La app no la usa. */
export const LOCAL_HARNESS = Symbol.for("brazo.computer.lease.harness");

export type LeaseInput = {
  organizationId: string;
  machineId: string;
  endpoint: string;
  token: string;
  operatorId: string;
};

type Options = {
  harness?: typeof LOCAL_HARNESS;
  lookupImpl?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  fetchImpl?: typeof fetch;
};

function aad(organizationId: string, machineId: string) {
  return `${AAD_VERSION}\n${organizationId}\n${machineId}`;
}

function operatorOk(operatorId: string) {
  return /^[a-z0-9][a-z0-9-]{2,40}$/.test(operatorId);
}

function bareHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function privateAddress(address: string) {
  const host = bareHost(address);
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped?.[1] ?? host;
  if (v4.includes(":")) {
    const head = (v4.split(":")[0] ?? "").toLowerCase();
    return head === "" || head.startsWith("fc") || head.startsWith("fd") || head.startsWith("fe80");
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

export async function endpointAllowed(raw: string, options: Options = {}) {
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
    if (options.harness !== LOCAL_HARNESS || url.protocol !== "http:") return null;
    return { origin: url.origin, pin: "127.0.0.1" };
  }
  if (url.protocol !== "https:") return null;
  if (privateAddress(host)) return null;
  try {
    const records = await (options.lookupImpl ?? ((hostname) => lookup(hostname, { all: true, verbatim: true })))(host);
    if (records.length === 0 || records.some((record) => privateAddress(record.address))) return null;
    const pin = records[0]?.address;
    if (!pin) return null;
    return { origin: url.origin, pin };
  } catch {
    return null;
  }
}

export async function revalidatePin(hostname: string, pin: string, lookupImpl?: Options["lookupImpl"]) {
  if (privateAddress(pin)) return false;
  const records = await (lookupImpl ?? ((host: string) => lookup(host, { all: true, verbatim: true })))(hostname);
  if (records.some((record) => privateAddress(record.address))) return false;
  return records.some((record) => record.address === pin);
}

async function attest(origin: string, pin: string, token: string, machineId: string, fetchImpl?: typeof fetch) {
  const response = fetchImpl
    ? await fetchImpl(`${origin}/status`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      })
    : await pinnedRequest({
        origin,
        pin,
        path: "/status",
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      }).then((result) => ({ status: result.status, json: async () => JSON.parse(result.body || "null") as unknown }));
  if ("status" in response && response.status !== 200) return false;
  const data = (await response.json().catch(() => null)) as { ok?: unknown; machineId?: unknown } | null;
  return Boolean(data && data.ok === true && data.machineId === machineId);
}

async function audit(input: { organizationId: string; machineId: string; operatorId: string; action: string; outcome: string; leaseEpoch: number }) {
  await prisma.computerLeaseAudit.create({ data: input });
}

async function organizationOpen(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true, isQa: true },
  });
  if (!organization || organization.suspendedAt || !organization.isQa) return false;
  return true;
}

export async function enrollComputerLease(input: LeaseInput, env: VaultEnv = process.env, options: Options = {}) {
  const token = input.token.trim();
  const machineId = input.machineId.trim();
  if (!operatorOk(input.operatorId)) return { ok: false as const, error: "operador" as const };
  if (token.length < 16 || token.length > 200) return { ok: false as const, error: "datos" as const };
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(machineId)) return { ok: false as const, error: "datos" as const };
  if (!(await organizationOpen(input.organizationId))) return { ok: false as const, error: "suspendida" as const };
  const target = await endpointAllowed(input.endpoint, options);
  if (!target) return { ok: false as const, error: "datos" as const };
  let attested = false;
  try {
    attested = await attest(target.origin, target.pin, token, machineId, options.fetchImpl);
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
    const saved = await prisma.$transaction(async (tx) => {
      const current = await tx.computer.findUnique({ where: { clientId: input.organizationId } });
      const taken = await tx.computer.findFirst({
        where: { machineId, NOT: { clientId: input.organizationId } },
        select: { id: true },
      });
      if (taken) return "maquina" as const;
      const epoch = (current?.leaseEpoch ?? 0) + 1;
      if (current && current.leaseEpoch !== epoch - 1) return "conflicto" as const;
      const data = {
        machineId,
        status: "RUNNING" as const,
        agentEndpoint: target.origin,
        agentPinnedAddress: target.pin,
        agentTokenCiphertext: sealed.ciphertext,
        agentTokenIv: sealed.iv,
        agentTokenAuthTag: sealed.authTag,
        leaseEpoch: epoch,
      };
      if (!current) {
        await tx.computer.create({ data: { clientId: input.organizationId, ...data } });
      } else {
        const updated = await tx.computer.updateMany({
          where: { clientId: input.organizationId, leaseEpoch: current.leaseEpoch },
          data,
        });
        if (updated.count !== 1) return "conflicto" as const;
      }
      await tx.computerLeaseAudit.create({
        data: { organizationId: input.organizationId, machineId, operatorId: input.operatorId, action: "enroll", outcome: "ok", leaseEpoch: epoch },
      });
      return epoch;
    });
    if (saved === "maquina" || saved === "conflicto") return { ok: false as const, error: saved };
    return { ok: true as const, machineId, configured: true as const, leaseEpoch: saved };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false as const, error: "maquina" as const };
    }
    throw error;
  }
}

export async function revokeComputerLease(organizationId: string, operatorId: string) {
  if (!operatorOk(operatorId)) return { ok: false as const, error: "operador" as const };
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row) return { ok: false as const, error: "ausente" as const };
  const updated = await prisma.computer.updateMany({
    where: { clientId: organizationId, leaseEpoch: row.leaseEpoch },
    data: {
      status: "STOPPED",
      leaseEpoch: row.leaseEpoch + 1,
      agentEndpoint: "",
      agentPinnedAddress: "",
      agentTokenCiphertext: "",
      agentTokenIv: "",
      agentTokenAuthTag: "",
    },
  });
  if (updated.count !== 1) return { ok: false as const, error: "conflicto" as const };
  await audit({
    organizationId,
    machineId: row.machineId,
    operatorId,
    action: "revoke",
    outcome: "ok",
    leaseEpoch: row.leaseEpoch + 1,
  });
  return { ok: true as const, leaseEpoch: row.leaseEpoch + 1 };
}

export async function loadTenantLease(organizationId: string, env: VaultEnv = process.env, options: Options = {}): Promise<LeaseState> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true, isQa: true },
  });
  if (!organization || organization.suspendedAt || !organization.isQa) return { state: "ausente" };
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row || row.status !== "RUNNING" || !row.machineId.trim() || !row.agentEndpoint.trim() || !row.agentPinnedAddress.trim()) {
    return { state: "ausente" };
  }
  if (!row.agentTokenCiphertext || !row.agentTokenIv || !row.agentTokenAuthTag) return { state: "ausente" };
  let origin: URL;
  try {
    origin = new URL(row.agentEndpoint);
  } catch {
    return { state: "transporte" };
  }
  if (options.harness !== LOCAL_HARNESS && (origin.hostname === "127.0.0.1" || origin.protocol !== "https:")) {
    return { state: "transporte" };
  }
  if (options.harness !== LOCAL_HARNESS) {
    const still = await revalidatePin(origin.hostname, row.agentPinnedAddress, options.lookupImpl).catch(() => false);
    if (!still) return { state: "transporte" };
  }
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
    {
      organizationId,
      machineId: row.machineId,
      baseUrl: row.agentEndpoint,
      pin: row.agentPinnedAddress,
      epoch: row.leaseEpoch,
      token,
    },
    organizationId,
  );
  if (!usable && options.harness !== LOCAL_HARNESS) return { state: "transporte" };
  if (!usable && origin.hostname !== "127.0.0.1") return { state: "transporte" };
  return {
    state: "listo",
    lease: usable ?? {
      organizationId,
      machineId: row.machineId,
      baseUrl: origin.origin,
      pin: "127.0.0.1",
      epoch: row.leaseEpoch,
      token,
    },
  };
}
