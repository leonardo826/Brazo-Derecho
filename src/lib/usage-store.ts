import type { Prisma } from "@prisma/client";
import { limitFor, type AgentId, type MetricId } from "@/lib/catalog";
import type { TokenUsage } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";
import { evaluateLimit, monthBounds, summarizeUsage, type UsageSlice } from "@/lib/usage";

type ReserveInput = {
  organizationId: string;
  agent: AgentId;
  metric: MetricId;
  quantity: number;
  tokens?: TokenUsage;
  now?: Date;
};

export async function usedThisMonth(organizationId: string, metric: MetricId, now = new Date()) {
  const { start, end } = monthBounds(now);
  const aggregate = await prisma.usageEvent.aggregate({
    where: { organizationId, metric, createdAt: { gte: start, lt: end } },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

export async function reserveUsage(tx: Prisma.TransactionClient, input: ReserveInput) {
  const { start, end } = monthBounds(input.now);
  const aggregate = await tx.usageEvent.aggregate({
    where: {
      organizationId: input.organizationId,
      agent: input.agent,
      metric: input.metric,
      createdAt: { gte: start, lt: end },
    },
    _sum: { quantity: true },
  });
  const used = aggregate._sum.quantity ?? 0;
  const decision = evaluateLimit(used, input.quantity, limitFor(input.agent, input.metric));
  if (!decision.ok) return decision;
  await tx.usageEvent.create({
    data: {
      organizationId: input.organizationId,
      agent: input.agent,
      metric: input.metric,
      quantity: input.quantity,
      inputTokens: input.tokens?.inputTokens ?? 0,
      cachedTokens: input.tokens?.cachedTokens ?? 0,
      outputTokens: input.tokens?.outputTokens ?? 0,
    },
  });
  return decision;
}

export async function usageSnapshot(organizationId: string, now = new Date()) {
  const bounds = monthBounds(now);
  const events = await prisma.usageEvent.findMany({
    where: {
      organizationId,
      createdAt: { gte: bounds.start, lt: bounds.end },
    },
  });
  const slices: UsageSlice[] = events.map((event) => ({
    agent: event.agent,
    metric: event.metric,
    quantity: event.quantity,
    inputTokens: event.inputTokens,
    cachedTokens: event.cachedTokens,
    outputTokens: event.outputTokens,
  }));
  return { ...bounds, ...summarizeUsage(slices) };
}
