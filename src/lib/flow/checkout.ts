import type { AgentId } from "@/lib/catalog";
import { appUrl } from "@/lib/env";
import { FlowApiError, flowCall } from "@/lib/flow/client";
import { flowRedirectUrl, planFor, trialDaysToAsk } from "@/lib/flow/plans";
import { prisma } from "@/lib/prisma";
import { assertBillableOrganization } from "@/lib/qa-account";
import { iabotChargeClp, TRIAL_DAYS } from "@/lib/subscription";
import { beginTrialIfIdle } from "@/lib/trial-guard";

type CustomerResponse = { customerId?: string };
type PlanResponse = { planId?: string; amount?: number | string };
type SubscriptionResponse = {
  subscriptionId?: string;
  status?: number | string;
  trial_end?: string | null;
  trial_period_days?: number | string;
};
type RegisterResponse = { url?: string; token?: string };

function parseFlowDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function ensureCustomer(input: { organizationId: string; name: string; email: string }) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
  if (organization.flowCustomerId) return organization.flowCustomerId;
  const created = await flowCall<CustomerResponse>(
    "customer/create",
    {
      name: input.name,
      email: input.email,
      externalId: input.organizationId,
    },
    "POST",
  );
  if (!created.customerId) throw new Error("Flow no entregó el cliente");
  await prisma.organization.update({
    where: { id: input.organizationId },
    data: { flowCustomerId: created.customerId },
  });
  return created.customerId;
}

function readFlowAmount(amount: number | string | undefined) {
  if (typeof amount === "number" && Number.isInteger(amount) && amount > 0) return amount;
  if (typeof amount === "string" && /^[1-9]\d*$/.test(amount)) return Number(amount);
  return null;
}

/** El plan remoto tiene que ser el precio publicado. Si no se puede comprobar, no se cobra. */
async function ensurePublishedPlan(agent: AgentId) {
  const plan = planFor(agent);
  const offer = iabotChargeClp();
  if (!Number.isInteger(offer) || offer <= 0) {
    throw new FlowApiError("El precio publicado no es válido", 400);
  }
  let remote: PlanResponse | null = null;
  try {
    remote = await flowCall<PlanResponse>("plans/get", { planId: plan.planId }, "GET");
  } catch {
    remote = null;
  }
  if (!remote) {
    await flowCall<PlanResponse>(
      "plans/create",
      {
        planId: plan.planId,
        name: plan.name,
        currency: "CLP",
        amount: offer,
        interval: 3,
        interval_count: 1,
        trial_period_days: TRIAL_DAYS,
        days_until_due: 3,
        urlCallback: `${appUrl()}/api/flow/confirmacion`,
      },
      "POST",
    );
    return { ...plan, amountClp: offer };
  }
  if (readFlowAmount(remote.amount) !== offer) {
    throw new FlowApiError("Flow no tiene el precio publicado de esta oferta", 409);
  }
  return { ...plan, amountClp: offer };
}

export async function startFlowSubscription(input: {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  agent: AgentId;
  now?: Date;
}) {
  await assertBillableOrganization(input.organizationId);
  const now = input.now ?? new Date();
  const existing = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
  });
  const plan = await ensurePublishedPlan(input.agent);
  const customerId = await ensureCustomer({
    organizationId: input.organizationId,
    name: `${input.name} · ${input.organizationName}`.slice(0, 120),
    email: input.email,
  });
  const trialDays = trialDaysToAsk(existing, now);
  let flowSubscriptionId = existing?.flowSubscriptionId ?? "";

  if (!flowSubscriptionId || existing?.status === "CANCELED") {
    const created = await flowCall<SubscriptionResponse>(
      "subscription/create",
      {
        planId: plan.planId,
        customerId,
        trial_period_days: trialDays,
      },
      "POST",
    );
    if (!created.subscriptionId) throw new Error("Flow no entregó la suscripción");
    flowSubscriptionId = created.subscriptionId;
    const trialEndAt = parseFlowDate(created.trial_end);
    const periodEnd =
      trialDays > 0
        ? trialEndAt && trialEndAt.getTime() > now.getTime()
          ? trialEndAt
          : new Date(now.getTime() + trialDays * 86_400_000)
        : existing && existing.periodEnd.getTime() > now.getTime()
          ? existing.periodEnd
          : now;
    if (trialDays > 0) {
      await beginTrialIfIdle({
        organizationId: input.organizationId,
        agent: input.agent,
        now,
        periodEnd,
      });
    }
    await prisma.subscription.update({
      where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
      data: { flowSubscriptionId, flowPlanId: plan.planId, amountClp: plan.amountClp },
    });
  } else {
    await prisma.subscription.update({
      where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
      data: { flowPlanId: plan.planId },
    });
  }

  const register = await flowCall<RegisterResponse>(
    "customer/register",
    {
      customerId,
      url_return: `${appUrl()}/api/flow/confirmacion`,
    },
    "POST",
  );
  return flowRedirectUrl(register.url ?? "", register.token ?? "");
}

export async function cancelFlowSubscription(organizationId: string, agent: AgentId) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
  });
  if (!subscription?.flowSubscriptionId) return false;
  await flowCall("subscription/cancel", { subscriptionId: subscription.flowSubscriptionId }, "POST");
  const now = new Date();
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "CANCELED", periodEnd: now },
  });
  return true;
}
