import type { AgentId } from "@/lib/catalog";
import { lockTransaction, trialLockName } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import { trialEnd } from "@/lib/subscription";

export type TrialGate = "opened" | "kept-active" | "kept-trial";

/**
 * Abre una prueba solo si no hay un plan o una prueba vigentes.
 * El candado y el WHERE impiden que un aviso de pago ACTIVE quede pisado por TRIAL.
 */
export async function beginTrialIfIdle(input: {
  organizationId: string;
  agent: AgentId;
  now?: Date;
  periodEnd?: Date;
}): Promise<TrialGate> {
  const now = input.now ?? new Date();
  const periodEnd = input.periodEnd && input.periodEnd.getTime() > now.getTime() ? input.periodEnd : trialEnd(now);
  return prisma.$transaction(async (tx) => {
    await lockTransaction(tx, trialLockName(input.organizationId, input.agent));
    const row = await tx.subscription.findUnique({
      where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
    });
    if (row?.status === "ACTIVE" && row.periodEnd.getTime() > now.getTime()) return "kept-active";
    if (row?.status === "TRIAL" && row.periodEnd.getTime() > now.getTime()) return "kept-trial";
    if (!row) {
      await tx.subscription.create({
        data: {
          organizationId: input.organizationId,
          agent: input.agent,
          status: "TRIAL",
          periodStart: now,
          periodEnd,
        },
      });
      return "opened";
    }
    const updated = await tx.subscription.updateMany({
      where: {
        id: row.id,
        NOT: {
          OR: [
            { status: "ACTIVE", periodEnd: { gt: now } },
            { status: "TRIAL", periodEnd: { gt: now } },
          ],
        },
      },
      data: { status: "TRIAL", periodStart: now, periodEnd },
    });
    if (updated.count === 1) return "opened";
    const fresh = await tx.subscription.findUnique({ where: { id: row.id } });
    if (fresh?.status === "ACTIVE" && fresh.periodEnd.getTime() > now.getTime()) return "kept-active";
    return "kept-trial";
  });
}
