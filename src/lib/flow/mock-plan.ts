import type { SubStatus } from "@/lib/flow/state";

type MockSubscription = { status: SubStatus; periodEnd: Date } | null | undefined;

export function canActivateMockPlan(subscription: MockSubscription, now = new Date()) {
  if (!subscription) return false;
  if (subscription.status !== "TRIAL" && subscription.status !== "ACTIVE") return false;
  return subscription.periodEnd.getTime() > now.getTime();
}
