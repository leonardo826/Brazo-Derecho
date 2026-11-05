import type { Prisma } from "@/generated/prisma/client";
import {
  applyMeterEvent,
  buildMonthBill,
  sanitizeTokens,
  type MeterBucket,
  type MeterKind,
  type MonthBill,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { TokenUsage } from "@/lib/pricing";
import { monthBounds, monthKey } from "@/lib/usage";

export type MeterWrite = {
  organizationId: string;
  kind: MeterKind;
  model?: string;
  tokens?: Partial<TokenUsage>;
  synthetic?: boolean;
  now?: Date;
};

export async function applyMeter(tx: Prisma.TransactionClient, input: MeterWrite) {
  const tokens = sanitizeTokens(input.tokens);
  const now = input.now ?? new Date();
  const yearMonth = monthKey(now);
  const delta = applyMeterEvent(
    { tasksCount: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
    { kind: input.kind, ...tokens, synthetic: input.synthetic },
  );
  await tx.usageMeter.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      model: (input.model ?? "").slice(0, 120),
      inputTokens: tokens.inputTokens,
      cachedTokens: tokens.cachedTokens,
      outputTokens: tokens.outputTokens,
      synthetic: input.synthetic ?? false,
      createdAt: now,
    },
  });
  await tx.usageMonth.upsert({
    where: {
      organizationId_yearMonth: { organizationId: input.organizationId, yearMonth },
    },
    create: {
      organizationId: input.organizationId,
      yearMonth,
      tasksCount: delta.tasksCount,
      inputTokens: delta.inputTokens,
      cachedTokens: delta.cachedTokens,
      outputTokens: delta.outputTokens,
    },
    update: {
      tasksCount: { increment: delta.tasksCount },
      inputTokens: { increment: delta.inputTokens },
      cachedTokens: { increment: delta.cachedTokens },
      outputTokens: { increment: delta.outputTokens },
    },
  });
  return { yearMonth, ...delta };
}

export async function recordMeter(input: MeterWrite) {
  return prisma.$transaction((tx) => applyMeter(tx, input));
}

export async function recordModelCall(input: {
  organizationId: string;
  response: { model: string; usage: TokenUsage; mocked: boolean };
  kind?: "CHAT" | "COMPUTER_STEP";
  now?: Date;
}) {
  return recordMeter({
    organizationId: input.organizationId,
    kind: input.kind ?? "CHAT",
    model: input.response.model,
    tokens: input.response.usage,
    synthetic: input.response.mocked,
    now: input.now,
  });
}

export async function recordCompletedTask(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; model?: string; synthetic?: boolean; now?: Date },
) {
  return applyMeter(tx, {
    organizationId: input.organizationId,
    kind: "TASK",
    model: input.model,
    synthetic: input.synthetic,
    now: input.now,
  });
}

export async function recordComputerStep(input: {
  organizationId: string;
  model?: string;
  tokens?: Partial<TokenUsage>;
  synthetic?: boolean;
  now?: Date;
}) {
  return recordMeter({ ...input, kind: "COMPUTER_STEP" });
}

function asBuckets(
  rows: {
    model: string;
    synthetic: boolean;
    kind: MeterKind;
    _sum: { inputTokens: number | null; cachedTokens: number | null; outputTokens: number | null };
  }[],
): MeterBucket[] {
  return rows.map((row) => ({
    model: row.model,
    synthetic: row.synthetic,
    kind: row.kind,
    inputTokens: row._sum.inputTokens ?? 0,
    cachedTokens: row._sum.cachedTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
  }));
}

export async function companyMeter(organizationId: string, now = new Date()): Promise<MonthBill> {
  const bounds = monthBounds(now);
  const yearMonth = monthKey(now);
  const [month, grouped] = await Promise.all([
    prisma.usageMonth.findUnique({
      where: { organizationId_yearMonth: { organizationId, yearMonth } },
    }),
    prisma.usageMeter.groupBy({
      by: ["model", "synthetic", "kind"],
      where: { organizationId, createdAt: { gte: bounds.start, lt: bounds.end } },
      _sum: { inputTokens: true, cachedTokens: true, outputTokens: true },
    }),
  ]);
  return buildMonthBill({
    yearMonth,
    label: bounds.label,
    month,
    buckets: asBuckets(grouped),
  });
}

export async function metersByOrganization(organizationIds: string[], now = new Date()) {
  const bounds = monthBounds(now);
  const yearMonth = monthKey(now);
  const bills = new Map<string, MonthBill>();
  if (organizationIds.length === 0) return bills;
  const [months, grouped] = await Promise.all([
    prisma.usageMonth.findMany({
      where: { organizationId: { in: organizationIds }, yearMonth },
    }),
    prisma.usageMeter.groupBy({
      by: ["organizationId", "model", "synthetic", "kind"],
      where: { organizationId: { in: organizationIds }, createdAt: { gte: bounds.start, lt: bounds.end } },
      _sum: { inputTokens: true, cachedTokens: true, outputTokens: true },
    }),
  ]);
  const buckets = new Map<string, MeterBucket[]>();
  for (const row of grouped) {
    const list = buckets.get(row.organizationId) ?? [];
    list.push({
      model: row.model,
      synthetic: row.synthetic,
      kind: row.kind,
      inputTokens: row._sum.inputTokens ?? 0,
      cachedTokens: row._sum.cachedTokens ?? 0,
      outputTokens: row._sum.outputTokens ?? 0,
    });
    buckets.set(row.organizationId, list);
  }
  const monthById = new Map(months.map((month) => [month.organizationId, month]));
  for (const id of organizationIds) {
    bills.set(
      id,
      buildMonthBill({
        yearMonth,
        label: bounds.label,
        month: monthById.get(id) ?? null,
        buckets: buckets.get(id) ?? [],
      }),
    );
  }
  return bills;
}
