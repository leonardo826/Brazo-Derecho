import { formatDay } from "@/lib/format";

export const TRIAL_DAYS = 7;

/** Precio mensual de IA Bot Profesional, solo si Leonardo lo definió. No inventa cifras. */
export function iabotPriceClp(raw = process.env.IABOT_PRICE_CLP) {
  const value = raw?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
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
