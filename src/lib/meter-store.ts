import type { Prisma } from "@/generated/prisma/client";
import {
  applyMeterEvent,
  billWithoutCharges,
  buildMonthBill,
  sanitizeTokens,
  type MeterBucket,
  type MeterKind,
  type MonthBill,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import type { TokenUsage } from "@/lib/pricing";
import { organizationIsQa, qaOrganizationIdSet, recordsBillingUsage } from "@/lib/qa-account";
import { lockTransaction } from "@/lib/db-lock";
import { DAILY_TASK_LIMIT, dayBounds, monthBounds, monthKey } from "@/lib/usage";

export type MeterWrite = {
  organizationId: string;
  kind: MeterKind;
  model?: string;
  tokens?: Partial<TokenUsage>;
  synthetic?: boolean;
  now?: Date;
};

export async function applyMeter(tx: Prisma.TransactionClient, input: MeterWrite) {
  const now = input.now ?? new Date();
  const yearMonth = monthKey(now);
  if (!recordsBillingUsage(await organizationIsQa(input.organizationId, tx))) {
    return { yearMonth, tasksCount: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  }
  const tokens = sanitizeTokens(input.tokens);
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

/** Tareas del día en Chile. La cuenta QA devuelve 0 y no se le corta el piloto. */
export async function tasksToday(organizationId: string, now = new Date()) {
  if (!recordsBillingUsage(await organizationIsQa(organizationId))) return 0;
  const { start, end } = dayBounds(now);
  return prisma.usageMeter.count({
    where: { organizationId, kind: "TASK", createdAt: { gte: start, lt: end } },
  });
}

export type TaskSlot =
  | { ok: true; reservationId: string | null }
  | { ok: false; reason: "limite" };

/**
 * Reserva una tarea antes de llamar al modelo. El conteo y el insert van en la
 * misma transacción, con candado por empresa y día de Chile. La cuenta QA no reserva.
 */
export async function reserveDailyTask(organizationId: string, now = new Date()): Promise<TaskSlot> {
  if (!recordsBillingUsage(await organizationIsQa(organizationId))) {
    return { ok: true, reservationId: null };
  }
  const { start, end } = dayBounds(now);
  return prisma.$transaction(async (tx) => {
    await lockTransaction(tx, `tasks:${organizationId}:${start.toISOString()}`);
    const count = await tx.usageMeter.count({
      where: { organizationId, kind: "TASK", createdAt: { gte: start, lt: end } },
    });
    if (count >= DAILY_TASK_LIMIT) return { ok: false, reason: "limite" };
    const row = await tx.usageMeter.create({
      data: { organizationId, kind: "TASK", createdAt: now },
    });
    const yearMonth = monthKey(now);
    await tx.usageMonth.upsert({
      where: { organizationId_yearMonth: { organizationId, yearMonth } },
      create: { organizationId, yearMonth, tasksCount: 1 },
      update: { tasksCount: { increment: 1 } },
    });
    return { ok: true, reservationId: row.id };
  });
}

/** Suelta una reserva. Dos sueltas a la vez no borran de más ni dejan el mes en negativo. */
export async function releaseDailyTask(reservationId: string | null | undefined) {
  if (!reservationId) return;
  await prisma.$transaction(async (tx) => {
    const row = await tx.usageMeter.findUnique({ where: { id: reservationId } });
    if (!row || row.kind !== "TASK") return;
    const removed = await tx.usageMeter.deleteMany({ where: { id: reservationId, kind: "TASK" } });
    if (removed.count !== 1) return;
    await tx.usageMonth.updateMany({
      where: {
        organizationId: row.organizationId,
        yearMonth: monthKey(row.createdAt),
        tasksCount: { gt: 0 },
      },
      data: { tasksCount: { decrement: 1 } },
    });
  });
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
  input: { organizationId: string; model?: string; synthetic?: boolean; now?: Date; reservationId?: string | null },
) {
  if ("reservationId" in input) {
    if (input.reservationId) {
      await tx.usageMeter.update({
        where: { id: input.reservationId },
        data: {
          model: (input.model ?? "").slice(0, 120),
          synthetic: input.synthetic ?? false,
        },
      });
    }
    return { reserved: Boolean(input.reservationId) };
  }
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

function emptyBill(yearMonth: string, label: string) {
  return billWithoutCharges(buildMonthBill({ yearMonth, label, month: null, buckets: [] }));
}

export async function companyMeter(organizationId: string, now = new Date()): Promise<MonthBill> {
  const bounds = monthBounds(now);
  const yearMonth = monthKey(now);
  if (!recordsBillingUsage(await organizationIsQa(organizationId))) {
    return emptyBill(yearMonth, bounds.label);
  }
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
  const qa = await qaOrganizationIdSet(organizationIds);
  const billable = organizationIds.filter((id) => recordsBillingUsage(qa.has(id)));
  if (billable.length === 0) {
    for (const id of organizationIds) bills.set(id, emptyBill(yearMonth, bounds.label));
    return bills;
  }
  const [months, grouped] = await Promise.all([
    prisma.usageMonth.findMany({
      where: { organizationId: { in: billable }, yearMonth },
    }),
    prisma.usageMeter.groupBy({
      by: ["organizationId", "model", "synthetic", "kind"],
      where: { organizationId: { in: billable }, createdAt: { gte: bounds.start, lt: bounds.end } },
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
    if (!recordsBillingUsage(qa.has(id))) {
      bills.set(id, emptyBill(yearMonth, bounds.label));
      continue;
    }
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
