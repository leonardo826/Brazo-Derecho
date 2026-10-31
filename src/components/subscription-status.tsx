import { subscriptionView } from "@/lib/subscription";

export function SubscriptionBadge({
  subscription,
}: {
  subscription: { status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED"; periodEnd: Date } | null | undefined;
}) {
  const view = subscriptionView(subscription);
  return <p className={`badge ${view.tone}`}>{view.label}</p>;
}
