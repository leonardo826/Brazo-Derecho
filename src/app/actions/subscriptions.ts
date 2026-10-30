"use server";

import { redirect } from "next/navigation";
import { isAgentId } from "@/lib/catalog";
import { assertOwnOrganizationActive, guardMutation, withNotice } from "@/lib/guard";
import { cancelFlowSubscription, startFlowSubscription } from "@/lib/flow/checkout";
import { flowIsConfigured } from "@/lib/flow/client";
import { activateMockPlan } from "@/lib/flow/mock-checkout";
import { paymentReturnPath, safePanelPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { trialEnd } from "@/lib/subscription";

export async function activateTrialAction(formData: FormData) {
  const back = safePanelPath(String(formData.get("back") ?? "/panel"));
  await guardMutation(formData, back);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  const agentRaw = String(formData.get("agent") ?? "");
  if (!isAgentId(agentRaw)) redirect(`${back}?error=datos`);
  const guia = formData.get("guia") === "1" ? "&guia=1" : "";

  if (flowIsConfigured()) {
    let url: string | null = null;
    try {
      url = await startFlowSubscription({
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        email: session.email,
        name: session.name,
        agent: agentRaw,
      });
    } catch (error) {
      console.error("Flow no pudo iniciar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=flow`);
    }
    if (url) redirect(url);
    redirect(`${back}?ok=flow`);
  }

  const now = new Date();
  await prisma.subscription.upsert({
    where: {
      organizationId_agent: {
        organizationId: session.organizationId,
        agent: agentRaw,
      },
    },
    create: {
      organizationId: session.organizationId,
      agent: agentRaw,
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
    },
    update: {
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
    },
  });
  redirect(`${back}?ok=prueba${guia}`);
}

export async function cancelSubscriptionAction(formData: FormData) {
  const back = safePanelPath(String(formData.get("back") ?? "/panel"));
  await guardMutation(formData, back);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  const agentRaw = String(formData.get("agent") ?? "");
  if (!isAgentId(agentRaw)) redirect(`${back}?error=datos`);

  if (flowIsConfigured()) {
    try {
      const canceled = await cancelFlowSubscription(session.organizationId, agentRaw);
      if (canceled) redirect(`${back}?ok=cancelada`);
    } catch (error) {
      console.error("Flow no pudo cancelar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=flow`);
    }
  }

  const now = new Date();
  await prisma.subscription.updateMany({
    where: {
      organizationId: session.organizationId,
      agent: agentRaw,
      status: { in: ["TRIAL", "ACTIVE"] },
    },
    data: { status: "CANCELED", periodEnd: now },
  });
  redirect(`${back}?ok=cancelada`);
}

export async function confirmMockPaymentAction(formData: FormData) {
  const back = paymentReturnPath(String(formData.get("back") ?? "/panel"));
  const agentRaw = String(formData.get("agent") ?? "");
  const checkout = isAgentId(agentRaw)
    ? `/panel/pago?agente=${encodeURIComponent(agentRaw)}&volver=${encodeURIComponent(back)}`
    : "/panel/pago";
  await guardMutation(formData, checkout);
  if (flowIsConfigured()) redirect(`${back}?error=flow`);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  if (!isAgentId(agentRaw)) redirect(withNotice(checkout, "error", "datos"));
  const activated = await activateMockPlan(session.organizationId, agentRaw);
  if (!activated.ok) redirect(withNotice(checkout, "error", "suscripcion"));
  redirect(withNotice(back, "ok", "plan"));
}
