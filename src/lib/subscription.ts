import { formatClp, formatDay } from "@/lib/format";

export const TRIAL_DAYS = 7;

/**
 * Precio mensual bruto de IA Bot Profesional, IVA incluido.
 * 53.400 × 1,19 = 63.546. Lo usan la portada, el panel y Mercado Pago.
 */
export const IABOT_PRICE_CLP = 63546;

/** Neto que estaba en el entorno. No se muestra ni se cobra. */
const IABOT_PRICE_NET_LEGACY_CLP = "53400";

/**
 * Precio de vitrina. Vacío, o el neto antiguo, usan el bruto.
 * Otro entero positivo lo reemplaza. Un texto inválido no inventa un monto.
 */
export function iabotPriceClp(raw: string | undefined = process.env.IABOT_PRICE_CLP): number | null {
  const value = raw?.trim() ?? "";
  if (!value || value === IABOT_PRICE_NET_LEGACY_CLP) return IABOT_PRICE_CLP;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

/** Monto del preapproval. Si el entorno no trae un precio válido, cobra el bruto. */
export function iabotChargeClp(raw?: string) {
  return iabotPriceClp(raw) ?? IABOT_PRICE_CLP;
}

/** Aviso público del plan publicado. Si la vitrina no muestra precio, no inventa un monto. */
export function iabotPriceNotice(raw?: string) {
  const price = iabotPriceClp(raw);
  if (price == null) return "Precio de lanzamiento: pronto.";
  return `IA Bot Profesional: ${formatClp(price)} al mes, IVA incluido.`;
}

export function trialEnd(from = new Date()) {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

export function isSubscriptionOpen(
  subscription: { status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED"; periodEnd: Date } | null | undefined,
  now = new Date(),
) {
  if (!subscription) return false;
  if (subscription.status !== "TRIAL" && subscription.status !== "ACTIVE") return false;
  return subscription.periodEnd.getTime() > now.getTime();
}

export function subscriptionView(
  subscription: { status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED"; periodEnd: Date } | null | undefined,
  now = new Date(),
) {
  if (!isSubscriptionOpen(subscription, now)) {
    if (subscription?.status === "CANCELED") {
      return { open: false as const, tone: "warn" as const, label: "Suscripción cancelada" };
    }
    if (subscription) return { open: false as const, tone: "warn" as const, label: "Suscripción vencida" };
    return { open: false as const, tone: "warn" as const, label: "Sin suscripción activa" };
  }
  if (subscription?.status === "ACTIVE") {
    return { open: true as const, tone: "good" as const, label: `Activa hasta el ${formatDay(subscription.periodEnd)}` };
  }
  return {
    open: true as const,
    tone: "good" as const,
    label: `Prueba hasta el ${formatDay(subscription?.periodEnd ?? now)}`,
  };
}
