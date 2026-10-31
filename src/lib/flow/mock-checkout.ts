import type { AgentId } from "@/lib/catalog";
import { canActivateMockPlan } from "@/lib/flow/mock-plan";
import { planFor } from "@/lib/flow/plans";
import { addOneMonth } from "@/lib/flow/state";
import { prisma } from "@/lib/prisma";

export { canActivateMockPlan } from "@/lib/flow/mock-plan";

export async function activateMockPlan(organizationId: string, agent: AgentId, now = new Date()) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
  });
  if (!subscription || !canActivateMockPlan(subscription, now)) return { ok: false as const };
  if (subscription.status === "ACTIVE") return { ok: true as const, already: true as const };

  const plan = planFor(agent);
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      status: "ACTIVE",
      periodStart: now,
      periodEnd: addOneMonth(now),
      flowPlanId: plan.planId,
      amountClp: plan.amountClp,
      flowSubscriptionId: null,
    },
  });
  return { ok: true as const, already: false as const };
}
