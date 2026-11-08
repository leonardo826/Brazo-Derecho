import { decryptSecret, encryptSecret, readMasterKey, type VaultEnv } from "@/lib/credentials/crypto";
import { usableLease, type ComputerLease, type LeaseState } from "@/lib/chat/desktop-task";
import { prisma } from "@/lib/prisma";

export type LeaseInput = {
  organizationId: string;
  machineId: string;
  endpoint: string;
  token: string;
};

export async function saveComputerLease(input: LeaseInput, env: VaultEnv = process.env) {
  const token = input.token.trim();
  const machineId = input.machineId.trim();
  if (token.length < 16 || token.length > 200) return { ok: false as const, error: "datos" as const };
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(machineId)) return { ok: false as const, error: "datos" as const };
  const probe = usableLease(
    { organizationId: input.organizationId, machineId, baseUrl: input.endpoint.trim(), token },
    input.organizationId,
  );
  if (!probe) return { ok: false as const, error: "datos" as const };
  let sealed;
  try {
    sealed = encryptSecret(token, readMasterKey(env));
  } catch {
    return { ok: false as const, error: "boveda_sin_clave" as const };
  }
  const taken = await prisma.computer.findFirst({
    where: { machineId, NOT: { clientId: input.organizationId } },
    select: { id: true },
  });
  if (taken) return { ok: false as const, error: "maquina" as const };
  await prisma.computer.upsert({
    where: { clientId: input.organizationId },
    create: {
      clientId: input.organizationId,
      machineId,
      status: "RUNNING",
      agentEndpoint: probe.baseUrl,
      agentTokenCiphertext: sealed.ciphertext,
      agentTokenIv: sealed.iv,
      agentTokenAuthTag: sealed.authTag,
    },
    update: {
      machineId,
      status: "RUNNING",
      agentEndpoint: probe.baseUrl,
      agentTokenCiphertext: sealed.ciphertext,
      agentTokenIv: sealed.iv,
      agentTokenAuthTag: sealed.authTag,
    },
  });
  return { ok: true as const, machineId, configured: true as const };
}

export async function loadTenantLease(organizationId: string, env: VaultEnv = process.env): Promise<LeaseState> {
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row || !row.machineId.trim() || !row.agentEndpoint.trim() || !row.agentTokenCiphertext || !row.agentTokenIv || !row.agentTokenAuthTag) {
    return { state: "ausente" };
  }
  let token = "";
  try {
    token = decryptSecret(
      { ciphertext: row.agentTokenCiphertext, iv: row.agentTokenIv, authTag: row.agentTokenAuthTag },
      readMasterKey(env),
    );
  } catch {
    return { state: "transporte" };
  }
  const lease: ComputerLease = {
    organizationId,
    machineId: row.machineId,
    baseUrl: row.agentEndpoint,
    token,
  };
  const usable = usableLease(lease, organizationId);
  if (!usable) return { state: "transporte" };
  return { state: "listo", lease: usable };
}
