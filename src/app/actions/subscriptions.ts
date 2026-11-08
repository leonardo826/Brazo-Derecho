"use server";

import { redirect } from "next/navigation";
import { isAgentId } from "@/lib/catalog";
import { assertOwnOrganizationActive, guardMutation, withNotice } from "@/lib/guard";
import { FlowApiError, flowIsConfigured } from "@/lib/flow/client";
import { activateMockPlan } from "@/lib/flow/mock-checkout";
import { MercadoPagoApiError, mercadoPagoIsConfigured } from "@/lib/mercadopago/client";
import { paymentReturnPath, safePanelPath } from "@/lib/paths";
import { getPaymentProvider } from "@/lib/payments/registry";
import { prisma } from "@/lib/prisma";
import { organizationIsQa, QaSinCobroError } from "@/lib/qa-account";
import { requireSession } from "@/lib/session";
import { beginTrialIfIdle } from "@/lib/trial-guard";
import { iabotChargeClp } from "@/lib/subscription";
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
  if (await organizationIsQa(session.organizationId)) redirect(withNotice(back, "ok", "qa_sin_cobro"));
  const provider = providerParsed.data;
  const guia = formData.get("guia") === "1" ? "&guia=1" : "";
  const offerClp = iabotChargeClp();

  if (provider === "mercadopago" && mercadoPagoIsConfigured()) {
    let redirectUrl = "";
    try {
      const started = await getPaymentProvider("mercadopago").startSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
        payerEmail: session.email,
        amountClp: offerClp,
      });
      redirectUrl = started.redirectUrl;
    } catch (error) {
      if (error instanceof QaSinCobroError) redirect(withNotice(back, "ok", "qa_sin_cobro"));
      if (error instanceof MercadoPagoApiError && error.status === 409) redirect(`${back}?error=mercadopago_activa`);
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
        amountClp: offerClp,
      });
      url = started.redirectUrl || null;
    } catch (error) {
      if (error instanceof QaSinCobroError) redirect(withNotice(back, "ok", "qa_sin_cobro"));
      if (error instanceof FlowApiError && error.status === 409) {
        redirect(`${back}?error=${error.code === "flow_activa" ? "flow_activa" : "flow_precio"}`);
      }
      console.error("Flow no pudo iniciar la suscripción", error instanceof Error ? error.name : "error");
      redirect(`${back}?error=flow`);
    }
    if (url) redirect(url);
    redirect(`${back}?ok=flow`);
  }

  const gate = await beginTrialIfIdle({
    organizationId: session.organizationId,
    agent: agentRaw,
  });
  if (provider === "mercadopago" && gate === "opened") {
    await prisma.subscription.updateMany({
      where: { organizationId: session.organizationId, agent: agentRaw, status: "TRIAL" },
      data: { provider: "MERCADOPAGO", mpPayerEmail: session.email },
    });
  }
  if (gate === "kept-active") redirect(withNotice(back, "ok", "ya_activa"));
  if (gate === "kept-trial") redirect(withNotice(back, "ok", "prueba_vigente"));
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
  if (await organizationIsQa(session.organizationId)) redirect(withNotice(back, "ok", "qa_sin_cobro"));
  if (!isAgentId(agentRaw)) redirect(withNotice(checkout, "error", "datos"));

  if (provider === "mercadopago" && mercadoPagoIsConfigured()) {
    let redirectUrl = "";
    try {
      const started = await getPaymentProvider("mercadopago").startSubscription({
        organizationId: session.organizationId,
        agent: agentRaw,
        payerEmail: session.email,
        amountClp: iabotChargeClp(),
      });
      redirectUrl = started.redirectUrl;
    } catch (error) {
      if (error instanceof QaSinCobroError) redirect(withNotice(back, "ok", "qa_sin_cobro"));
      if (error instanceof MercadoPagoApiError && error.status === 409) redirect(withNotice(back, "error", "mercadopago_activa"));
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
