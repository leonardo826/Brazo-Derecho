import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

/** Dos enteros estables para pg_advisory_xact_lock. El candado muere con la transacción. */
export function advisoryPair(name: string): [number, number] {
  const buf = createHash("sha256").update(name).digest();
  return [buf.readInt32BE(0), buf.readInt32BE(4)];
}

export async function lockTransaction(tx: Prisma.TransactionClient, name: string) {
  const [left, right] = advisoryPair(name);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${left}::integer, ${right}::integer)`;
}

export function trialLockName(organizationId: string, agent: string) {
  return `trial:${organizationId}:${agent}`;
}
