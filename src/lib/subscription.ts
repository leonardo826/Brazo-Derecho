export const TRIAL_DAYS = 14;

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
