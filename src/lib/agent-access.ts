import type { AgentId } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { isSubscriptionOpen } from "@/lib/subscription";

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
      select: { suspendedAt: true },
    }),
  ]);
  const suspended = Boolean(organization?.suspendedAt);
  return { subscription, suspended, open: !suspended && isSubscriptionOpen(subscription, now) };
}
