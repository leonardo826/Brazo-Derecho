import { Prisma } from "@/generated/prisma/client";
import { FLOW_PAYMENT, nextSubscriptionState, type SubStatus } from "@/lib/flow/state";
import {
  billingNoticeKeys,
  mercadoPagoReferences,
  mercadoPagoToFlowSignal,
} from "@/lib/mercadopago/state";
import { prisma } from "@/lib/prisma";

async function locateSubscription(refs: ReturnType<typeof mercadoPagoReferences>) {
  if (refs.externalReference) {
    const byId = await prisma.subscription.findUnique({ where: { id: refs.externalReference } });
    if (byId) return byId;
  }
  if (refs.preapprovalId) {
    const byPreapproval = await prisma.subscription.findUnique({ where: { mpPreapprovalId: refs.preapprovalId } });
    if (byPreapproval) return byPreapproval;
  }
  return null;
}

async function rememberNotices(keys: string[], subscriptionId: string) {
  if (keys.length === 0) return;
  await prisma.mercadoPagoNotice.createMany({ data: keys.map((noticeKey) => ({ noticeKey, subscriptionId })) });
}

export async function applyMercadoPagoResource(input: {
  topic: string;
  dataId: string;
  resource: unknown;
  now?: Date;
}) {
  const signal = mercadoPagoToFlowSignal(input.topic, input.resource);
  const refs = mercadoPagoReferences(input.topic, input.resource);
  const subscription = await locateSubscription(refs);
  if (!subscription || !signal) return { repeated: false, status: null as SubStatus | null, updated: false };

  const now = input.now ?? new Date();
  const keys = billingNoticeKeys(input.topic, input.dataId, input.resource);
  if (keys.length > 0) {
    const seen = await prisma.mercadoPagoNotice.findFirst({ where: { noticeKey: { in: keys } } });
    if (seen) return { repeated: true, status: subscription.status as SubStatus, updated: false };
  }

  const activeNow = subscription.status === "ACTIVE" && subscription.periodEnd.getTime() > now.getTime();
  if (signal.paymentStatus === FLOW_PAYMENT.PAID && input.topic === "subscription_preapproval" && activeNow) {
    return { repeated: true, status: subscription.status as SubStatus, updated: false };
  }

  if (signal.paymentStatus === FLOW_PAYMENT.PAID && keys.length > 0 && activeNow) {
    const prior = await prisma.mercadoPagoNotice.count({
      where: { subscriptionId: subscription.id, noticeKey: { startsWith: "pago:" } },
    });
    if (prior === 0) {
      try {
        await rememberNotices(keys, subscription.id);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { repeated: true, status: subscription.status as SubStatus, updated: false };
        }
        throw error;
      }
      return { repeated: false, status: subscription.status as SubStatus, updated: false };
    }
  }

  const next = nextSubscriptionState(
    { status: subscription.status as SubStatus, periodEnd: subscription.periodEnd },
    signal,
    now,
  );

  try {
    await prisma.$transaction(async (tx) => {
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
      if (keys.length > 0) {
        await tx.mercadoPagoNotice.createMany({
          data: keys.map((noticeKey) => ({ noticeKey, subscriptionId: subscription.id })),
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { repeated: true, status: subscription.status as SubStatus, updated: false };
    }
    throw error;
  }

  return { repeated: false, status: next?.status ?? null, updated: Boolean(next) };
}
