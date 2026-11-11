import type { AgentId } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { isSubscriptionOpen } from "@/lib/subscription";

type OpenSubscription = { status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED"; periodEnd: Date } | null | undefined;

/** La empresa de prueba interna entra a todos los módulos. Una suspendida no. El resto necesita prueba o plan vigente. */
export function moduleIsOpen(input: { suspended: boolean; qa: boolean; subscription: OpenSubscription; now?: Date }) {
  if (input.suspended) return false;
  if (input.qa) return true;
  return isSubscriptionOpen(input.subscription, input.now);
}

export async function loadSubscription(organizationId: string, agent: AgentId) {
  return prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
  });
}

export async function agentIsOpen(organizationId: string, agent: AgentId, now = new Date()) {
  const [subscription, organization] = await Promise.all([
    loadSubscription(organizationId, agent),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { suspendedAt: true, isQa: true },
    }),
  ]);
  const suspended = Boolean(organization?.suspendedAt);
  const qa = organization?.isQa === true;
  return { subscription, suspended, qa, open: moduleIsOpen({ suspended, qa, subscription, now }) };
}
