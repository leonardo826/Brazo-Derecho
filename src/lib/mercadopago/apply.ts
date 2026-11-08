import { Prisma } from "@/generated/prisma/client";
import { lockTransaction, trialLockName } from "@/lib/db-lock";
import { FLOW_PAYMENT, keepPaidPlan, nextSubscriptionState, type SubStatus } from "@/lib/flow/state";
import {
  billingNoticeKeys,
  mercadoPagoReferences,
  mercadoPagoToFlowSignal,
  subscriptionForMercadoPago,
} from "@/lib/mercadopago/state";
import { prisma } from "@/lib/prisma";

async function locateSubscription(refs: ReturnType<typeof mercadoPagoReferences>) {
  const byReference = refs.externalReference
    ? await prisma.subscription.findUnique({ where: { id: refs.externalReference } })
    : null;
  const byPreapproval = refs.preapprovalId
    ? await prisma.subscription.findUnique({ where: { mpPreapprovalId: refs.preapprovalId } })
    : null;
  const chosen = subscriptionForMercadoPago({
    byReference,
    byPreapproval,
    preapprovalId: refs.preapprovalId,
  });
  if (!chosen) return null;
  return byReference?.id === chosen.id ? byReference : byPreapproval;
}

export async function applyMercadoPagoResource(input: {
  topic: string;
  dataId: string;
  resource: unknown;
  now?: Date;
}) {
  const signal = mercadoPagoToFlowSignal(input.topic, input.resource);
  const refs = mercadoPagoReferences(input.topic, input.resource);
  const located = await locateSubscription(refs);
  if (!located || !signal) return { repeated: false, status: null as SubStatus | null, updated: false };

  const now = input.now ?? new Date();
  const keys = billingNoticeKeys(input.topic, input.dataId, input.resource);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockTransaction(tx, trialLockName(located.organizationId, located.agent));
      const subscription = await tx.subscription.findUnique({ where: { id: located.id } });
      if (!subscription) return { repeated: false, status: null as SubStatus | null, updated: false };
      if (keys.length > 0) {
        const seen = await tx.mercadoPagoNotice.findFirst({ where: { noticeKey: { in: keys } } });
        if (seen) return { repeated: true, status: subscription.status as SubStatus, updated: false };
      }

      const trialNow = subscription.status === "TRIAL" && subscription.periodEnd.getTime() > now.getTime();
      if (signal.paymentStatus === FLOW_PAYMENT.PAID && input.topic === "subscription_preapproval" && trialNow) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            provider: "MERCADOPAGO",
            mpPreapprovalId: refs.preapprovalId || subscription.mpPreapprovalId,
            mpPayerEmail: refs.payerEmail || subscription.mpPayerEmail,
          },
        });
        return { repeated: false, status: subscription.status as SubStatus, updated: false };
      }

      const activeNow = subscription.status === "ACTIVE" && subscription.periodEnd.getTime() > now.getTime();
      if (signal.paymentStatus === FLOW_PAYMENT.PAID && input.topic === "subscription_preapproval" && activeNow) {
        return { repeated: true, status: subscription.status as SubStatus, updated: false };
      }

      if (signal.paymentStatus === FLOW_PAYMENT.PAID && keys.length > 0 && activeNow) {
        const prior = await tx.mercadoPagoNotice.count({
          where: { subscriptionId: subscription.id, noticeKey: { startsWith: "pago:" } },
        });
        if (prior === 0) {
          await tx.mercadoPagoNotice.createMany({
            data: keys.map((noticeKey) => ({ noticeKey, subscriptionId: subscription.id })),
          });
          return { repeated: false, status: subscription.status as SubStatus, updated: false };
        }
      }

      const next = keepPaidPlan(
        subscription,
        nextSubscriptionState(
          { status: subscription.status as SubStatus, periodEnd: subscription.periodEnd },
          signal,
          now,
        ),
        now,
      );
      if (keys.length > 0) {
        await tx.mercadoPagoNotice.createMany({
          data: keys.map((noticeKey) => ({ noticeKey, subscriptionId: subscription.id })),
        });
      }
      if (next) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: next.status,
            periodStart: next.periodStart,
            periodEnd: next.periodEnd,
            provider: "MERCADOPAGO",
            mpPreapprovalId: refs.preapprovalId || subscription.mpPreapprovalId,
            mpPayerEmail: refs.payerEmail || subscription.mpPayerEmail,
          },
        });
      }
      return { repeated: false, status: (next?.status ?? subscription.status) as SubStatus, updated: Boolean(next) };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const fresh = await prisma.subscription.findUnique({ where: { id: located.id } });
      return { repeated: true, status: (fresh?.status as SubStatus | undefined) ?? null, updated: false };
    }
    throw error;
  }
}
