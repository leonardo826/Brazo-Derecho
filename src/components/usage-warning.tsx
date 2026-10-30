import type { MetricId } from "@/lib/catalog";
import { usageAlertMessage, usageAlerts } from "@/lib/usage";

export function UsageWarningBanner({ totals }: { totals: Record<MetricId, number> }) {
  const alerts = usageAlerts(totals);
  if (alerts.length === 0) return null;
  return (
    <div className="banner warn" role="status">
      {alerts.map((alert) => (
        <p key={`${alert.agent}-${alert.metric}`}>{usageAlertMessage(alert)}</p>
      ))}
    </div>
  );
}
