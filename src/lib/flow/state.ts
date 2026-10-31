import type { AgentId } from "@/lib/catalog";
import { isAgentId } from "@/lib/catalog";
import { agentForAmount, agentForPlanId } from "@/lib/flow/plans";
import { TRIAL_DAYS } from "@/lib/subscription";

export const FLOW_PAYMENT = {
  PENDING: 1,
  PAID: 2,
  REJECTED: 3,
  CANCELED: 4,
} as const;

export const FLOW_SUBSCRIPTION = {
  ACTIVE: 1,
  TRIAL: 2,
  CANCELED: 4,
} as const;

export type SubStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED";

export type FlowSignal = {
  paymentStatus?: number | null;
  subscriptionStatus?: number | null;
  morose?: number | null;
  periodEnd?: Date | null;
};

export function addOneMonth(from: Date) {
  const next = new Date(from.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + 1);
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
}

export function asFlowNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function nextSubscriptionState(
  current: { status: SubStatus; periodEnd: Date } | null,
  signal: FlowSignal,
  now = new Date(),
): { status: SubStatus; periodStart: Date; periodEnd: Date } | null {
  const inTrial = current?.status === "TRIAL" && current.periodEnd.getTime() > now.getTime();

  if (signal.subscriptionStatus === FLOW_SUBSCRIPTION.CANCELED || signal.paymentStatus === FLOW_PAYMENT.CANCELED) {
    return { status: "CANCELED", periodStart: now, periodEnd: now };
  }

  if (signal.paymentStatus === FLOW_PAYMENT.PAID) {
    const end = signal.periodEnd && signal.periodEnd.getTime() > now.getTime() ? signal.periodEnd : addOneMonth(now);
    return { status: "ACTIVE", periodStart: now, periodEnd: end };
  }

  if (signal.paymentStatus === FLOW_PAYMENT.REJECTED || signal.morose === 1) {
    if (inTrial) return null;
    return { status: "EXPIRED", periodStart: now, periodEnd: now };
  }

  if (signal.subscriptionStatus === FLOW_SUBSCRIPTION.TRIAL) {
    const end =
      signal.periodEnd && signal.periodEnd.getTime() > now.getTime()
        ? signal.periodEnd
        : new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
    return { status: "TRIAL", periodStart: now, periodEnd: end };
  }

  if (signal.subscriptionStatus === FLOW_SUBSCRIPTION.ACTIVE && signal.periodEnd && signal.periodEnd.getTime() > now.getTime()) {
    return {
      status: inTrial ? "TRIAL" : "ACTIVE",
      periodStart: now,
      periodEnd: signal.periodEnd,
    };
  }

  return null;
}

export type FlowPaymentView = {
  status?: unknown;
  amount?: unknown;
  payer?: unknown;
  subject?: unknown;
  commerceOrder?: unknown;
  flowOrder?: unknown;
  subscriptionId?: unknown;
  planId?: unknown;
  customerId?: unknown;
  optional?: unknown;
};

function optionalRecord(optional: unknown) {
  let source: unknown = optional;
  if (typeof optional === "string" && optional.trim()) {
    try {
      source = JSON.parse(optional);
    } catch {
      return {};
    }
  }
  if (!source || typeof source !== "object") return {};
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    record[key] = String(value);
  }
  return record;
}

export function flowTargetFromPayment(payment: FlowPaymentView) {
  const optional = optionalRecord(payment.optional);
  const commerceOrder = typeof payment.commerceOrder === "string" ? payment.commerceOrder : "";
  const subscriptionFromOrder = commerceOrder.match(/sus_[a-z0-9]+/i)?.[0];
  const planId =
    (typeof payment.planId === "string" && payment.planId) || optional.planId || "";
  const agentRaw = optional.agent;
  const amount = asFlowNumber(payment.amount);
  const agent =
    (agentRaw && isAgentId(agentRaw) ? agentRaw : null) ||
    (planId ? agentForPlanId(planId) : null) ||
    (amount != null ? agentForAmount(amount) : null);
  return {
    subscriptionId:
      (typeof payment.subscriptionId === "string" && payment.subscriptionId) ||
      optional.subscriptionId ||
      subscriptionFromOrder ||
      "",
    organizationId: optional.organizationId || "",
    customerId: (typeof payment.customerId === "string" && payment.customerId) || optional.customerId || "",
    payer: typeof payment.payer === "string" ? payment.payer.trim().toLowerCase() : "",
    planId,
    agent: agent as AgentId | null,
    amount,
    paymentStatus: asFlowNumber(payment.status),
    flowOrder: asFlowNumber(payment.flowOrder),
  };
}
