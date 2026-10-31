import { FLOW_PAYMENT, FLOW_SUBSCRIPTION, type FlowSignal } from "@/lib/flow/state";

export const MERCADOPAGO_TOPICS = ["subscription_preapproval", "subscription_authorized_payment", "payment"] as const;

export type MercadoPagoTopic = (typeof MERCADOPAGO_TOPICS)[number];

export function isMercadoPagoTopic(value: string | null | undefined): value is MercadoPagoTopic {
  return MERCADOPAGO_TOPICS.some((topic) => topic === value);
}

export function mercadoPagoResourcePath(topic: MercadoPagoTopic, dataId: string) {
  const id = encodeURIComponent(dataId);
  if (topic === "subscription_preapproval") return `/preapproval/${id}`;
  if (topic === "subscription_authorized_payment") return `/authorized_payments/${id}`;
  return `/v1/payments/${id}`;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim();
}

function lower(value: unknown) {
  return asText(value).toLowerCase();
}

function nestedPaymentStatus(resource: Record<string, unknown>) {
  return lower(asRecord(resource.payment).status);
}

/**
 * Traduce el recurso consultado a la señal que ya entiende nextSubscriptionState.
 * authorized → pago acreditado (ACTIVE). paused/cancelled → CANCELED.
 * Pago rechazado, vencido o contracargo → REJECTED (EXPIRED fuera de la prueba).
 */
export function mercadoPagoToFlowSignal(topic: string, resource: unknown): FlowSignal | null {
  const record = asRecord(resource);
  const status = lower(record.status);
  const paymentStatus = nestedPaymentStatus(record);

  if (topic === "subscription_preapproval") {
    if (status === "authorized") return { paymentStatus: FLOW_PAYMENT.PAID };
    if (status === "paused" || status === "cancelled" || status === "canceled") {
      return { subscriptionStatus: FLOW_SUBSCRIPTION.CANCELED };
    }
    return null;
  }

  if (topic !== "subscription_authorized_payment" && topic !== "payment") return null;

  if (
    status === "cancelled" ||
    status === "canceled" ||
    paymentStatus === "cancelled" ||
    paymentStatus === "canceled" ||
    paymentStatus === "refunded" ||
    status === "refunded"
  ) {
    return { paymentStatus: FLOW_PAYMENT.CANCELED };
  }

  const outcome = paymentStatus || status;
  if (outcome === "approved" || outcome === "accredited" || outcome === "authorized") {
    return { paymentStatus: FLOW_PAYMENT.PAID };
  }
  if (outcome === "rejected" || outcome === "expired" || outcome === "charged_back" || outcome === "overdue") {
    return { paymentStatus: FLOW_PAYMENT.REJECTED };
  }
  return null;
}

export function mercadoPagoReferences(topic: string, resource: unknown) {
  const record = asRecord(resource);
  const payment = asRecord(record.payment);
  const payer = asRecord(record.payer);
  const point = asRecord(record.point_of_interaction);
  const transaction = asRecord(point.transaction_data);
  const preapprovalId =
    topic === "subscription_preapproval"
      ? asText(record.id)
      : asText(record.preapproval_id) || asText(transaction.subscription_id);
  return {
    externalReference: asText(record.external_reference),
    preapprovalId,
    paymentId: asText(payment.id) || (topic === "payment" ? asText(record.id) : ""),
    payerEmail: (asText(record.payer_email) || asText(payer.email)).toLowerCase(),
  };
}

export function billingNoticeKeys(topic: string, dataId: string, resource: unknown) {
  if (topic !== "payment" && topic !== "subscription_authorized_payment") return [];
  const refs = mercadoPagoReferences(topic, resource);
  const keys = new Set<string>();
  if (topic === "payment") keys.add(`pago:${dataId}`);
  if (topic === "subscription_authorized_payment") keys.add(`pago:ap:${dataId}`);
  if (refs.paymentId) keys.add(`pago:${refs.paymentId}`);
  return [...keys];
}

export function readMercadoPagoDataId(body: unknown) {
  const data = asRecord(asRecord(body).data);
  return asText(data.id);
}

export function readMercadoPagoTopic(body: unknown) {
  const record = asRecord(body);
  return asText(record.type) || asText(record.topic);
}
