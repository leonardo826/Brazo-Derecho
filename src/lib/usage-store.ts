import type { Prisma } from "@/generated/prisma/client";
import { limitFor, type AgentId, type MetricId } from "@/lib/catalog";
import type { TokenUsage } from "@/lib/pricing";
import { prisma } from "@/lib/prisma";
import { organizationIsQa, qaOrganizationIdSet, recordsBillingUsage } from "@/lib/qa-account";
import { evaluateLimit, monthBounds, summarizeUsage, type UsageSlice } from "@/lib/usage";

type ReserveInput = {
  organizationId: string;
  agent: AgentId;
  metric: MetricId;
  quantity: number;
  tokens?: TokenUsage;
  model?: string;
  now?: Date;
};

export async function usedThisMonth(organizationId: string, metric: MetricId, now = new Date()) {
  if (!recordsBillingUsage(await organizationIsQa(organizationId))) return 0;
  const { start, end } = monthBounds(now);
  const aggregate = await prisma.usageEvent.aggregate({
    where: { organizationId, metric, createdAt: { gte: start, lt: end } },
    _sum: { quantity: true },
  });
  return aggregate._sum.quantity ?? 0;
}

export async function reserveUsage(tx: Prisma.TransactionClient, input: ReserveInput) {
  if (!recordsBillingUsage(await organizationIsQa(input.organizationId, tx))) {
    const limit = limitFor(input.agent, input.metric);
    return { ok: true as const, used: 0, limit, remaining: limit };
  }
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
      model: input.model ?? "",
    },
  });
  return decision;
}

export async function usageByOrganization(organizationIds: string[], now = new Date()) {
  const bounds = monthBounds(now);
  const grouped = new Map<string, UsageSlice[]>();
  for (const id of organizationIds) grouped.set(id, []);
  if (organizationIds.length === 0) {
    return { label: bounds.label, byOrganization: new Map<string, ReturnType<typeof summarizeUsage>>() };
  }
  const qa = await qaOrganizationIdSet(organizationIds);
  const billable = organizationIds.filter((id) => recordsBillingUsage(qa.has(id)));
  const events =
    billable.length === 0
      ? []
      : await prisma.usageEvent.findMany({
          where: {
            organizationId: { in: billable },
            createdAt: { gte: bounds.start, lt: bounds.end },
          },
        });
  for (const event of events) {
    grouped.get(event.organizationId)?.push({
      agent: event.agent,
      metric: event.metric,
      quantity: event.quantity,
      inputTokens: event.inputTokens,
      cachedTokens: event.cachedTokens,
      outputTokens: event.outputTokens,
      model: event.model,
    });
  }
  const byOrganization = new Map<string, ReturnType<typeof summarizeUsage>>();
  for (const [id, slices] of grouped) byOrganization.set(id, summarizeUsage(slices));
  return { label: bounds.label, byOrganization };
}

export async function usageSnapshot(organizationId: string, now = new Date()) {
  const bounds = monthBounds(now);
  if (!recordsBillingUsage(await organizationIsQa(organizationId))) {
    return { ...bounds, ...summarizeUsage([]) };
  }
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
    model: event.model,
  }));
  return { ...bounds, ...summarizeUsage(slices) };
}
