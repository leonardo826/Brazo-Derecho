import { USAGE_WARN_AT } from "@/lib/usage";

export function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const ratio = limit === 0 ? 0 : used / limit;
  const pct = used > 0 ? Math.max(Math.min(ratio * 100, 100), 2) : 0;
  return (
    <div>
      <div className="bar-label">
        <span>{label}</span>
        <span>
          {used.toLocaleString("es-CL")} / {limit.toLocaleString("es-CL")}
        </span>
      </div>
      <div
        className={ratio >= USAGE_WARN_AT ? "bar warn" : "bar"}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
