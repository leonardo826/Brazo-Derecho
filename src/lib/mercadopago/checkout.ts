import type { AgentId } from "@/lib/catalog";
import { appUrl } from "@/lib/env";
import { planFor } from "@/lib/flow/plans";
import { logEvent } from "@/lib/log";
import {
  mercadoPagoAccessToken,
  mercadoPagoCall,
  mercadoPagoIsConfigured,
  MercadoPagoApiError,
} from "@/lib/mercadopago/client";
import { prisma } from "@/lib/prisma";
import { trialEnd } from "@/lib/subscription";

type PreapprovalResponse = { id?: string | number; init_point?: string };

export function preapprovalPayerEmail(signedInEmail: string) {
  const override = process.env.MERCADOPAGO_TEST_PAYER_EMAIL?.trim() ?? "";
  if (mercadoPagoAccessToken().startsWith("TEST-") && override) return override;
  return signedInEmail;
}

export function buildPreapprovalPayload(input: {
  subscriptionId: string;
  payerEmail: string;
  reason: string;
  amountClp: number;
}) {
  return {
    payer_email: preapprovalPayerEmail(input.payerEmail),
    reason: input.reason,
    external_reference: input.subscriptionId,
    back_url: `${appUrl()}/panel/pago`,
    notification_url: `${appUrl()}/api/mercadopago/webhook`,
    status: "pending" as const,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months" as const,
      transaction_amount: input.amountClp,
      currency_id: "CLP" as const,
    },
  };
}

export async function startMercadoPagoSubscription(
  input: {
    organizationId: string;
    agent: AgentId;
    payerEmail: string;
    amountClp: number;
    now?: Date;
  },
  fetchImpl: typeof fetch = fetch,
) {
  if (!mercadoPagoIsConfigured()) throw new MercadoPagoApiError("Mercado Pago no está configurado", 503);
  if (!Number.isInteger(input.amountClp) || input.amountClp <= 0) {
    throw new MercadoPagoApiError("Monto inválido", 400);
  }
  const now = input.now ?? new Date();
  const plan = planFor(input.agent);
  const existing = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
  });
  const open = Boolean(
    existing &&
      (existing.status === "TRIAL" || existing.status === "ACTIVE") &&
      existing.periodEnd.getTime() > now.getTime(),
  );
  const subscription = await prisma.subscription.upsert({
    where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
    create: {
      organizationId: input.organizationId,
      agent: input.agent,
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
      provider: "MERCADOPAGO",
      amountClp: input.amountClp,
      mpPayerEmail: input.payerEmail,
    },
    update: {
      provider: "MERCADOPAGO",
      amountClp: input.amountClp,
      mpPayerEmail: input.payerEmail,
      ...(open ? {} : { status: "TRIAL" as const, periodStart: now, periodEnd: trialEnd(now) }),
    },
  });
  const previousId = existing?.mpPreapprovalId ?? null;
  const created = await mercadoPagoCall<PreapprovalResponse>(
    "/preapproval",
    {
      method: "POST",
      body: buildPreapprovalPayload({
        subscriptionId: subscription.id,
        payerEmail: input.payerEmail,
        reason: plan.name,
        amountClp: input.amountClp,
      }),
    },
    fetchImpl,
  );
  const preapprovalId = created.id != null ? String(created.id).trim() : "";
  const redirectUrl = typeof created.init_point === "string" ? created.init_point.trim() : "";
  if (!preapprovalId || !redirectUrl) throw new MercadoPagoApiError("Mercado Pago no entregó el checkout", 502);
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { mpPreapprovalId: preapprovalId },
  });
  if (previousId && previousId !== preapprovalId) {
    try {
      await mercadoPagoCall(
        `/preapproval/${encodeURIComponent(previousId)}`,
        { method: "PUT", body: { status: "cancelled" } },
        fetchImpl,
      );
    } catch {
      logEvent("mercadopago.preapproval", { status: 502, reason: "cancelar_anterior" });
    }
  }
  return redirectUrl;
}

export async function cancelMercadoPagoSubscription(
  organizationId: string,
  agent: AgentId,
  fetchImpl: typeof fetch = fetch,
) {
  if (!mercadoPagoIsConfigured()) return false;
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
  });
  if (!subscription?.mpPreapprovalId) return false;
  await mercadoPagoCall(
    `/preapproval/${encodeURIComponent(subscription.mpPreapprovalId)}`,
    { method: "PUT", body: { status: "cancelled" } },
    fetchImpl,
  );
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "CANCELED", periodEnd: new Date() },
  });
  return true;
}
