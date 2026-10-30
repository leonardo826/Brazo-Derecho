import type { AgentId } from "@/lib/catalog";
import { appUrl } from "@/lib/env";
import { flowCall } from "@/lib/flow/client";
import { flowRedirectUrl, planFor, trialDaysToAsk } from "@/lib/flow/plans";
import { prisma } from "@/lib/prisma";
import { TRIAL_DAYS } from "@/lib/subscription";

type CustomerResponse = { customerId?: string };
type PlanResponse = { planId?: string };
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

async function ensurePlan(agent: AgentId) {
  const plan = planFor(agent);
  try {
    await flowCall<PlanResponse>("plans/get", { planId: plan.planId }, "GET");
  } catch {
    await flowCall<PlanResponse>(
      "plans/create",
      {
        planId: plan.planId,
        name: plan.name,
        currency: "CLP",
        amount: plan.amountClp,
        interval: 3,
        interval_count: 1,
        trial_period_days: TRIAL_DAYS,
        days_until_due: 3,
        urlCallback: `${appUrl()}/api/flow/confirmacion`,
      },
      "POST",
    );
  }
  return plan;
}

export async function startFlowSubscription(input: {
  organizationId: string;
  organizationName: string;
  email: string;
  name: string;
  agent: AgentId;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const existing = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
  });
  const customerId = await ensureCustomer({
    organizationId: input.organizationId,
    name: `${input.name} · ${input.organizationName}`.slice(0, 120),
    email: input.email,
  });
  const plan = await ensurePlan(input.agent);
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
    const status = trialDays > 0 ? "TRIAL" : existing && existing.periodEnd.getTime() > now.getTime() ? existing.status : "EXPIRED";
    await prisma.subscription.upsert({
      where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
      create: {
        organizationId: input.organizationId,
        agent: input.agent,
        status,
        periodStart: now,
        periodEnd,
        flowSubscriptionId,
        flowPlanId: plan.planId,
        amountClp: plan.amountClp,
      },
      update: {
        status,
        periodStart: trialDays > 0 ? now : existing?.periodStart ?? now,
        periodEnd,
        flowSubscriptionId,
        flowPlanId: plan.planId,
        amountClp: plan.amountClp,
      },
    });
  } else {
    await prisma.subscription.update({
      where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
      data: { flowPlanId: plan.planId, amountClp: plan.amountClp },
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
