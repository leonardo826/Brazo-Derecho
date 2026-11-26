import { classifyEndpoint, computerTokenAad } from "@/lib/computer/lease";
import { qaEnrollConfigured, qaEnrollLogLine } from "@/lib/computer/qa-enroll-gate";
import { encryptSecret, readMasterKey, type VaultEnv } from "@/lib/credentials/crypto";
import { Prisma, prisma } from "@/lib/prisma";

const SLOTS = ["A", "B", "C"] as const;
const ID = /^[A-Za-z0-9_-]{4,80}$/;

type SlotName = (typeof SLOTS)[number];

type SlotSpec = {
  slot: SlotName;
  orgId: string;
  endpoint: string;
  machineName: string;
};

export type QaComputerRow = {
  clientId: string;
  machineId: string;
  status: string;
  agentEndpoint: string;
  agentPinnedAddress: string;
  agentTokenCiphertext: string;
  agentTokenIv: string;
  agentTokenAuthTag: string;
  leaseEpoch: number;
};

export type QaEnrollStore = {
  findByOrg(orgId: string): Promise<QaComputerRow | null>;
  machineOwner(machineId: string): Promise<string | null>;
  markQa(orgId: string): Promise<void>;
  insert(row: QaComputerRow): Promise<"ok" | "duplicado">;
};

type LookupImpl = (hostname: string) => Promise<{ address: string; family: number }[]>;

function parseSpec(raw: string): SlotSpec[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const slots: SlotSpec[] = [];
  for (const slot of SLOTS) {
    const item = record[slot];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const orgId = typeof row.orgId === "string" ? row.orgId.trim() : "";
    const endpoint = typeof row.endpoint === "string" ? row.endpoint.trim() : "";
    const machineName = typeof row.machineName === "string" ? row.machineName.trim() : "";
    if (!ID.test(orgId) || !ID.test(machineName) || !endpoint) return null;
    slots.push({ slot, orgId, endpoint, machineName });
  }
  const orgs = new Set(slots.map((slot) => slot.orgId));
  const machines = new Set(slots.map((slot) => slot.machineName));
  if (orgs.size !== SLOTS.length || machines.size !== SLOTS.length) return null;
  return slots;
}

function declaredOrigin(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sameLease(row: QaComputerRow, machineName: string, origin: string) {
  if (row.machineId !== machineName || row.status !== "RUNNING") return false;
  if (!row.agentTokenCiphertext || !row.agentTokenIv || !row.agentTokenAuthTag) return false;
  try {
    return new URL(row.agentEndpoint).origin === origin;
  } catch {
    return false;
  }
}

function tokenFor(env: VaultEnv, slot: SlotName) {
  const name = `QA_ENROLL_TOKEN_${slot}` as const;
  return env[name]?.trim() ?? "";
}

function prismaStore(): QaEnrollStore {
  return {
    async findByOrg(orgId) {
      return prisma.computer.findUnique({
        where: { clientId: orgId },
        select: {
          clientId: true,
          machineId: true,
          status: true,
          agentEndpoint: true,
          agentPinnedAddress: true,
          agentTokenCiphertext: true,
          agentTokenIv: true,
          agentTokenAuthTag: true,
          leaseEpoch: true,
        },
      });
    },
    async machineOwner(machineId) {
      const row = await prisma.computer.findFirst({ where: { machineId }, select: { clientId: true } });
      return row?.clientId ?? null;
    },
    async markQa(orgId) {
      await prisma.organization.updateMany({ where: { id: orgId }, data: { isQa: true } });
    },
    async insert(row) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.computer.create({
            data: {
              clientId: row.clientId,
              machineId: row.machineId,
              status: "RUNNING",
              agentEndpoint: row.agentEndpoint,
              agentPinnedAddress: row.agentPinnedAddress,
              agentTokenCiphertext: row.agentTokenCiphertext,
              agentTokenIv: row.agentTokenIv,
              agentTokenAuthTag: row.agentTokenAuthTag,
              leaseEpoch: 1,
            },
          });
          await tx.computerLeaseAudit.create({
            data: {
              organizationId: row.clientId,
              machineId: row.machineId,
              operatorId: "qa-enroll",
              action: "enroll",
              outcome: "ok",
              leaseEpoch: 1,
            },
          });
        });
        return "ok";
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicado";
        throw error;
      }
    },
  };
}

export async function runQaEnroll(
  env: VaultEnv = process.env,
  options: { store?: QaEnrollStore; lookupImpl?: LookupImpl; log?: (line: string) => void } = {},
) {
  const log = options.log ?? (() => undefined);
  const mode = qaEnrollConfigured(env);
  if (mode === "skip") return 0;
  if (mode === "partial") {
    log(qaEnrollLogLine("-", false));
    return 1;
  }
  const slots = parseSpec(env.QA_ENROLL_SPEC ?? "");
  if (!slots) {
    log(qaEnrollLogLine("-", false));
    return 1;
  }
  let key: Buffer;
  try {
    key = readMasterKey(env);
  } catch {
    log(qaEnrollLogLine("-", false));
    return 1;
  }
  const store = options.store ?? prismaStore();
  let failed = false;
  for (const slot of slots) {
    try {
      await store.markQa(slot.orgId);
      const current = await store.findByOrg(slot.orgId);
      const hinted = declaredOrigin(slot.endpoint);
      if (current && hinted && sameLease(current, slot.machineName, hinted)) {
        log(qaEnrollLogLine(slot.orgId, true));
        continue;
      }
      if (current) {
        log(qaEnrollLogLine(slot.orgId, false));
        failed = true;
        continue;
      }
      const target = await classifyEndpoint(slot.endpoint, { lookupImpl: options.lookupImpl });
      if (!target.ok) {
        log(qaEnrollLogLine(slot.orgId, false));
        if (target.reason !== "dns") failed = true;
        continue;
      }
      const owner = await store.machineOwner(slot.machineName);
      if (owner && owner !== slot.orgId) {
        log(qaEnrollLogLine(slot.orgId, false));
        failed = true;
        continue;
      }
      const token = tokenFor(env, slot.slot);
      if (token.length < 16 || token.length > 200) {
        log(qaEnrollLogLine(slot.orgId, false));
        failed = true;
        continue;
      }
      const sealed = encryptSecret(token, key, computerTokenAad(slot.orgId, slot.machineName));
      const row: QaComputerRow = {
        clientId: slot.orgId,
        machineId: slot.machineName,
        status: "RUNNING",
        agentEndpoint: target.origin,
        agentPinnedAddress: target.pin,
        agentTokenCiphertext: sealed.ciphertext,
        agentTokenIv: sealed.iv,
        agentTokenAuthTag: sealed.authTag,
        leaseEpoch: 1,
      };
      const saved = await store.insert(row);
      if (saved === "duplicado") {
        const again = await store.findByOrg(slot.orgId);
        if (!again || !sameLease(again, slot.machineName, target.origin)) {
          log(qaEnrollLogLine(slot.orgId, false));
          failed = true;
          continue;
        }
      }
      log(qaEnrollLogLine(slot.orgId, true));
    } catch {
      log(qaEnrollLogLine(slot.orgId, false));
      failed = true;
    }
  }
  return failed ? 1 : 0;
}
