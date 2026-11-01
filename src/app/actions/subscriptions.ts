"use server";

import { redirect } from "next/navigation";
import { isAgentId } from "@/lib/catalog";
import { assertOwnOrganizationActive, guardMutation, withNotice } from "@/lib/guard";
import { flowIsConfigured } from "@/lib/flow/client";
import { activateMockPlan } from "@/lib/flow/mock-checkout";
import { planFor } from "@/lib/flow/plans";
import { mercadoPagoIsConfigured } from "@/lib/mercadopago/client";
import { paymentReturnPath, safePanelPath } from "@/lib/paths";
import { getPaymentProvider } from "@/lib/payments/registry";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { trialEnd } from "@/lib/subscription";
import { paymentProviderSchema } from "@/lib/validation";

export async function activateTrialAction(formData: FormData) {
  const back = safePanelPath(String(formData.get("back") ?? "/panel"));
  await guardMutation(formData, back);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  const agentRaw = String(formData.get("agent") ?? "");
  if (!isAgentId(agentRaw)) redirect(`${back}?error=datos`);
  const providerParsed = paymentProviderSchema.safeParse(String(formData.get("provider") ?? "flow"));
  if (!providerParsed.success) redirect(`${back}?error=datos`);
  const provider = providerParsed.data;
  const guia = formData.get("guia") === "1" ? "&guia=1" : "";
  const amountClp = planFor(agentRaw).amountClp;

  if (provider === "mercadopago" && mercadoPagoIsConfigured()) {
    let redirectUrl = "";
    try {
      const started = await getPaymentProvider("mercadopago").startSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
        payerEmail: session.email,
        amountClp,
      });
      redirectUrl = started.redirectUrl;
    } catch (error) {
      console.error("Mercado Pago no pudo iniciar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=mercadopago`);
    }
    if (redirectUrl) redirect(redirectUrl);
    redirect(`${back}?error=mercadopago`);
  }

  if (provider === "flow" && flowIsConfigured()) {
    let url: string | null = null;
    try {
      const started = await getPaymentProvider("flow").startSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
        payerEmail: session.email,
        amountClp,
      });
      url = started.redirectUrl || null;
    } catch (error) {
      console.error("Flow no pudo iniciar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=flow`);
    }
    if (url) redirect(url);
    redirect(`${back}?ok=flow`);
  }

  const now = new Date();
  const mercadoPagoChoice =
    provider === "mercadopago" ? { provider: "MERCADOPAGO" as const, mpPayerEmail: session.email } : {};
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
      ...mercadoPagoChoice,
    },
    update: {
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
      ...mercadoPagoChoice,
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

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId: session.organizationId, agent: agentRaw } },
    select: { provider: true },
  });
  const provider = subscription?.provider === "MERCADOPAGO" ? "mercadopago" : "flow";

  if (provider === "flow" && flowIsConfigured()) {
    try {
      const canceled = await getPaymentProvider("flow").cancelSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
      });
      if (canceled) redirect(`${back}?ok=cancelada`);
    } catch (error) {
      console.error("Flow no pudo cancelar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=flow`);
    }
  }

  if (provider === "mercadopago" && mercadoPagoIsConfigured()) {
    try {
      const canceled = await getPaymentProvider("mercadopago").cancelSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
      });
      if (canceled) redirect(`${back}?ok=cancelada`);
    } catch (error) {
      console.error("Mercado Pago no pudo cancelar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=mercadopago`);
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
  const providerParsed = paymentProviderSchema.safeParse(String(formData.get("provider") ?? "flow"));
  if (!providerParsed.success) redirect(withNotice(checkout, "error", "datos"));
  const provider = providerParsed.data;
  if (provider === "flow" && flowIsConfigured()) redirect(`${back}?error=flow`);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  if (!isAgentId(agentRaw)) redirect(withNotice(checkout, "error", "datos"));

  if (provider === "mercadopago" && mercadoPagoIsConfigured()) {
    let redirectUrl = "";
    try {
      const started = await getPaymentProvider("mercadopago").startSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
        payerEmail: session.email,
        amountClp: planFor(agentRaw).amountClp,
      });
      redirectUrl = started.redirectUrl;
    } catch (error) {
      console.error("Mercado Pago no pudo iniciar la suscripción", error instanceof Error ? error.name : "error");
      redirect(withNotice(checkout, "error", "mercadopago"));
    }
    if (redirectUrl) redirect(redirectUrl);
    redirect(withNotice(checkout, "error", "mercadopago"));
  }

  const activated = await activateMockPlan(session.organizationId, agentRaw);
  if (!activated.ok) redirect(withNotice(checkout, "error", "suscripcion"));
  if (provider === "mercadopago") {
    await prisma.subscription.update({
      where: { organizationId_agent: { organizationId: session.organizationId, agent: agentRaw } },
      data: { provider: "MERCADOPAGO", mpPayerEmail: session.email },
    });
  }
  redirect(withNotice(back, "ok", "plan"));
}
