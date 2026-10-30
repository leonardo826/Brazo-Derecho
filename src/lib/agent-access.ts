import type { AgentId } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { isSubscriptionOpen } from "@/lib/subscription";

export async function loadSubscription(organizationId: string, agent: AgentId) {
  return prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
  });
}

export async function agentIsOpen(organizationId: string, agent: AgentId, now = new Date()) {
  const subscription = await loadSubscription(organizationId, agent);
  return { subscription, open: isSubscriptionOpen(subscription, now) };
}
