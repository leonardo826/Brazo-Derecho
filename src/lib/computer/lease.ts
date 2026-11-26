import { lookup } from "node:dns/promises";
import { roleMayManageMachine } from "@/lib/admin";
import { acceptHandshake, handshakeNonce } from "@/lib/computer/handshake";
import { signRequest } from "@/lib/computer/request-sign";
import { isPrivateAddress } from "@/lib/computer/private-address";
import { callMachine, revalidatePin, type LookupImpl } from "@/lib/computer/transport";
import { decryptSecret, encryptSecret, readMasterKey, type VaultEnv } from "@/lib/credentials/crypto";
import { usableLease, type LeaseState } from "@/lib/chat/desktop-task";
import { Prisma } from "@/lib/prisma";
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
  actorUserId: string;
  expectedEpoch?: number;
};

type Options = {
  harness?: typeof LOCAL_HARNESS;
  rotate?: boolean;
  lookupImpl?: LookupImpl;
  fetchImpl?: typeof fetch;
};

export function leaseGate(status: string): "running" | "closed" | "absent" {
  if (status === "STOPPED" || status === "ERROR") return "closed";
  if (status === "RUNNING") return "running";
  return "absent";
}

export function computerTokenAad(organizationId: string, machineId: string) {
  return `${AAD_VERSION}\n${organizationId}\n${machineId}`;
}

function aad(organizationId: string, machineId: string) {
  return computerTokenAad(organizationId, machineId);
}

function operatorOk(operatorId: string) {
  return /^[a-z0-9][a-z0-9-]{2,40}$/.test(operatorId);
}

function bareHost(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function privateAddress(address: string) {
  return isPrivateAddress(address);
}

function blockedHost(host: string) {
  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  );
}

export type EndpointVerdict =
  | { ok: true; origin: string; pin: string }
  | { ok: false; reason: "datos" | "dns" };

export async function classifyEndpoint(raw: string, options: Options = {}): Promise<EndpointVerdict> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "datos" };
  }
  if (url.username || url.password) return { ok: false, reason: "datos" };
  const host = bareHost(url.hostname);
  if (blockedHost(host)) return { ok: false, reason: "datos" };
  if (host === "127.0.0.1") {
    if (options.harness !== LOCAL_HARNESS || url.protocol !== "http:") return { ok: false, reason: "datos" };
    return { ok: true, origin: url.origin, pin: "127.0.0.1" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "datos" };
  if (isPrivateAddress(host)) return { ok: false, reason: "datos" };
  try {
    const records = await (options.lookupImpl ?? ((hostname: string) => lookup(hostname, { all: true, verbatim: true })))(host);
    if (records.length === 0) return { ok: false, reason: "dns" };
    if (records.some((record) => isPrivateAddress(record.address))) return { ok: false, reason: "datos" };
    const pin = records[0]?.address;
    if (!pin || isPrivateAddress(pin)) return { ok: false, reason: "datos" };
    return { ok: true, origin: url.origin, pin };
  } catch {
    return { ok: false, reason: "dns" };
  }
}

export async function endpointAllowed(raw: string, options: Options = {}) {
  const verdict = await classifyEndpoint(raw, options);
  return verdict.ok ? { origin: verdict.origin, pin: verdict.pin } : null;
}

async function manager(organizationId: string, actorUserId: string) {
  if (!actorUserId) return false;
  const user = await prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } });
  if (!user) return false;
  if (roleMayManageMachine(null, user.email)) return true;
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: actorUserId, organizationId } },
    select: { role: true },
  });
  return roleMayManageMachine(membership?.role ?? null, user.email);
}

async function attest(origin: string, pin: string, token: string, machineId: string, options: Options) {
  const nonce = handshakeNonce();
  const host = new URL(origin).hostname;
  const body = JSON.stringify({ nonce, machineId, host });
  const result = await callMachine({
    origin,
    pin,
    path: "/handshake",
    method: "POST",
    headers: { "content-type": "application/json", ...signRequest({ token, method: "POST", path: "/handshake", body, host }) },
    body,
    signal: AbortSignal.timeout(3_000),
    allowLoopback: options.harness === LOCAL_HARNESS,
    lookupImpl: options.lookupImpl,
    fetchImpl: options.fetchImpl,
  });
  if (result.status !== 200 || !result.body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body) as unknown;
  } catch {
    return false;
  }
  return acceptHandshake({ token, nonce, machineId, host, body: parsed });
}

async function organizationOpen(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true, isQa: true },
  });
  if (!organization || organization.suspendedAt || !organization.isQa) return false;
  return true;
}

function uniqueConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(" ") : String(target ?? "");
  if (text.includes("machineId")) return "maquina" as const;
  return "conflicto" as const;
}

export async function enrollComputerLease(input: LeaseInput, env: VaultEnv = process.env, options: Options = {}) {
  const token = input.token.trim();
  const machineId = input.machineId.trim();
  if (!operatorOk(input.operatorId)) return { ok: false as const, error: "operador" as const };
  if (token.length < 16 || token.length > 200) return { ok: false as const, error: "datos" as const };
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(machineId)) return { ok: false as const, error: "datos" as const };
  if (!(await manager(input.organizationId, input.actorUserId))) return { ok: false as const, error: "permiso" as const };
  if (!(await organizationOpen(input.organizationId))) return { ok: false as const, error: "suspendida" as const };
  const target = await endpointAllowed(input.endpoint, options);
  if (!target) return { ok: false as const, error: "datos" as const };
  let attested = false;
  try {
    attested = await attest(target.origin, target.pin, token, machineId, options);
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
      if (options.rotate && !current) return "ausente" as const;
      if (current && input.expectedEpoch !== current.leaseEpoch) return "conflicto" as const;
      const taken = await tx.computer.findFirst({
        where: { machineId, NOT: { clientId: input.organizationId } },
        select: { id: true },
      });
      if (taken) return "maquina" as const;
      const epoch = (current?.leaseEpoch ?? 0) + 1;
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
        data: {
          organizationId: input.organizationId,
          machineId,
          operatorId: input.operatorId,
          action: options.rotate ? "rotate" : "enroll",
          outcome: "ok",
          leaseEpoch: epoch,
        },
      });
      return epoch;
    });
    if (saved === "maquina" || saved === "conflicto" || saved === "ausente") return { ok: false as const, error: saved };
    return { ok: true as const, machineId, configured: true as const, leaseEpoch: saved };
  } catch (error) {
    const conflict = uniqueConflict(error);
    if (conflict) return { ok: false as const, error: conflict };
    throw error;
  }
}

export async function revokeComputerLease(input: { organizationId: string; operatorId: string; actorUserId: string; expectedEpoch?: number }) {
  if (!operatorOk(input.operatorId)) return { ok: false as const, error: "operador" as const };
  if (input.expectedEpoch === undefined || !Number.isInteger(input.expectedEpoch) || input.expectedEpoch < 0) {
    return { ok: false as const, error: "datos" as const };
  }
  if (!(await manager(input.organizationId, input.actorUserId))) return { ok: false as const, error: "permiso" as const };
  const expectedEpoch = input.expectedEpoch;
  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.computer.findUnique({ where: { clientId: input.organizationId } });
    if (!row) return "ausente" as const;
    if (row.leaseEpoch !== expectedEpoch) return "conflicto" as const;
    const nextEpoch = row.leaseEpoch + 1;
    const updated = await tx.computer.updateMany({
      where: { clientId: input.organizationId, leaseEpoch: row.leaseEpoch },
      data: {
        status: "STOPPED",
        leaseEpoch: nextEpoch,
        agentEndpoint: "",
        agentPinnedAddress: "",
        agentTokenCiphertext: "",
        agentTokenIv: "",
        agentTokenAuthTag: "",
      },
    });
    if (updated.count !== 1) return "conflicto" as const;
    await tx.computerLeaseAudit.create({
      data: {
        organizationId: input.organizationId,
        machineId: row.machineId,
        operatorId: input.operatorId,
        action: "revoke",
        outcome: "ok",
        leaseEpoch: nextEpoch,
      },
    });
    return nextEpoch;
  });
  if (typeof saved !== "number") return { ok: false as const, error: saved };
  return { ok: true as const, leaseEpoch: saved };
}

export async function loadTenantLease(organizationId: string, env: VaultEnv = process.env, options: Options = {}): Promise<LeaseState> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { suspendedAt: true, isQa: true },
    });
    if (!organization || organization.suspendedAt || !organization.isQa) return { state: "ausente" };
    const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
    if (!row) return { state: "ausente" };
    const gate = leaseGate(row.status);
    if (gate === "closed") return { state: "detenido" };
    if (gate !== "running" || !row.machineId.trim() || !row.agentEndpoint.trim() || !row.agentPinnedAddress.trim()) {
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
  } catch {
    return { state: "transporte" };
  }
}
