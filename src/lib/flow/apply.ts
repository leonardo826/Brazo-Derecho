import { Prisma } from "@prisma/client";
import type { AgentId } from "@/lib/catalog";
import { flowCall } from "@/lib/flow/client";
import { flowTargetFromPayment, nextSubscriptionState, type FlowPaymentView, type SubStatus } from "@/lib/flow/state";
import { prisma } from "@/lib/prisma";

type SubscriptionRow = {
  subscriptionId?: string;
  status?: number | string;
  morose?: number | string;
  period_end?: string | null;
  trial_end?: string | null;
  customerId?: string;
  planId?: string;
};

function parseFlowDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function locateSubscription(target: ReturnType<typeof flowTargetFromPayment>) {
  if (target.subscriptionId) {
    const byFlow = await prisma.subscription.findFirst({
      where: { flowSubscriptionId: target.subscriptionId },
    });
    if (byFlow) return byFlow;
  }
  if (target.organizationId && target.agent) {
    const byOrg = await prisma.subscription.findUnique({
      where: { organizationId_agent: { organizationId: target.organizationId, agent: target.agent } },
    });
    if (byOrg) return byOrg;
  }
  if (target.customerId && target.agent) {
    const organization = await prisma.organization.findUnique({ where: { flowCustomerId: target.customerId } });
    if (organization) {
      return prisma.subscription.findUnique({
        where: { organizationId_agent: { organizationId: organization.id, agent: target.agent } },
      });
    }
  }
  if (target.payer && target.agent) {
    const user = await prisma.user.findUnique({
      where: { email: target.payer },
      include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
    });
    const organizationId = user?.memberships[0]?.organizationId;
    if (organizationId) {
      return prisma.subscription.findUnique({
        where: { organizationId_agent: { organizationId, agent: target.agent } },
      });
    }
  }
  return null;
}

export async function applyFlowToken(token: string, now = new Date()) {
  const existing = await prisma.flowNotice.findUnique({ where: { token } });
  if (existing) return { ok: true as const, repeated: true };

  let payment: FlowPaymentView | null = null;
  try {
    payment = await flowCall<FlowPaymentView>("payment/getStatus", { token }, "GET");
  } catch {
    payment = null;
  }

  if (!payment) {
    try {
      await flowCall("customer/getRegisterStatus", { token }, "GET");
      await prisma.flowNotice.create({ data: { token } });
      return { ok: true as const, repeated: false, kind: "registro" as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { ok: true as const, repeated: true };
      }
      return { ok: false as const, status: 502 as const };
    }
  }

  const target = flowTargetFromPayment(payment);
  let remote: SubscriptionRow | null = null;
  if (target.subscriptionId) {
    try {
      remote = await flowCall<SubscriptionRow>("subscription/get", { subscriptionId: target.subscriptionId }, "GET");
    } catch {
      remote = null;
    }
  }

  const subscription = await locateSubscription({
    ...target,
    customerId: target.customerId || remote?.customerId || "",
    planId: target.planId || remote?.planId || "",
    agent: target.agent,
  });

  const next = subscription
    ? nextSubscriptionState(
        { status: subscription.status as SubStatus, periodEnd: subscription.periodEnd },
        {
          paymentStatus: target.paymentStatus,
          subscriptionStatus: remote ? Number(remote.status) : null,
          morose: remote ? Number(remote.morose) : null,
          periodEnd: parseFlowDate(remote?.period_end) ?? parseFlowDate(remote?.trial_end),
        },
        now,
      )
    : null;

  try {
    await prisma.$transaction(async (tx) => {
      if (subscription && next) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: next.status,
            periodStart: next.periodStart,
            periodEnd: next.periodEnd,
            flowSubscriptionId: target.subscriptionId || subscription.flowSubscriptionId,
            flowPlanId: target.planId || subscription.flowPlanId,
            amountClp: target.amount ?? subscription.amountClp,
          },
        });
      }
      await tx.flowNotice.create({
        data: {
          token,
          flowOrder: target.flowOrder,
          paymentStatus: target.paymentStatus,
          organizationId: subscription?.organizationId,
          agent: (subscription?.agent ?? target.agent) as AgentId | null,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true as const, repeated: true };
    }
    throw error;
  }

  return {
    ok: true as const,
    repeated: false,
    kind: "pago" as const,
    updated: Boolean(next),
    organizationId: subscription?.organizationId ?? null,
    agent: subscription?.agent ?? target.agent,
  };
}
