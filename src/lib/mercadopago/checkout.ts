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
import { assertBillableOrganization } from "@/lib/qa-account";
import { iabotChargeClp } from "@/lib/subscription";
import { beginTrialIfIdle } from "@/lib/trial-guard";

type PreapprovalResponse = { id?: string | number; init_point?: string };

export function preapprovalPayerEmail(signedInEmail: string) {
  const override = process.env.MERCADOPAGO_TEST_PAYER_EMAIL?.trim() ?? "";
  if (mercadoPagoAccessToken().startsWith("TEST-") && override) return override;
  return mercadoPagoSafeEmail(signedInEmail);
}

// Mercado Pago rechaza payer_email con alias "+" ("User bad request"); se envía la dirección base.
export function mercadoPagoSafeEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at).split("+")[0];
  return local ? `${local}${trimmed.slice(at)}` : trimmed;
}

export function buildPreapprovalPayload(input: {
  subscriptionId: string;
  payerEmail: string;
  reason: string;
  amountClp: number;
  /** Primer cobro: al terminar la prueba (TRIAL_DAYS) o el período ya pagado. */
  firstChargeAt?: Date;
}) {
  const firstCharge = input.firstChargeAt && input.firstChargeAt.getTime() > Date.now() ? input.firstChargeAt : null;
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
      ...(firstCharge ? { start_date: firstCharge.toISOString() } : {}),
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
  await assertBillableOrganization(input.organizationId);
  if (!mercadoPagoIsConfigured()) throw new MercadoPagoApiError("Mercado Pago no está configurado", 503);
  // El cobro es el precio bruto de la vitrina, no el monto que haya pasado quien llama.
  const amountClp = iabotChargeClp();
  if (!Number.isInteger(amountClp) || amountClp <= 0) {
    throw new MercadoPagoApiError("Monto inválido", 400);
  }
  const now = input.now ?? new Date();
  const plan = planFor(input.agent);
  await beginTrialIfIdle({ organizationId: input.organizationId, agent: input.agent, now });
  const subscription = await prisma.subscription.update({
    where: { organizationId_agent: { organizationId: input.organizationId, agent: input.agent } },
    data: {
      provider: "MERCADOPAGO",
      amountClp,
      mpPayerEmail: input.payerEmail,
    },
  });
  const previousId = subscription.mpPreapprovalId;
  const created = await mercadoPagoCall<PreapprovalResponse>(
    "/preapproval",
    {
      method: "POST",
      body: buildPreapprovalPayload({
        subscriptionId: subscription.id,
        payerEmail: input.payerEmail,
        reason: plan.name,
        amountClp,
        firstChargeAt: subscription.periodEnd,
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
