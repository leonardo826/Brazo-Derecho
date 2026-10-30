import { activateTrialAction, cancelSubscriptionAction } from "@/app/actions/subscriptions";
import { SubscriptionBadge } from "@/components/subscription-status";
import { flowIsConfigured } from "@/lib/flow/client";
import { isSubscriptionOpen } from "@/lib/subscription";

type SubscriptionView = {
  status: "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELED";
  periodEnd: Date;
  flowSubscriptionId?: string | null;
} | null;

export function SubscribeActions({
  agent,
  back,
  subscription,
}: {
  agent: string;
  back: string;
  subscription: SubscriptionView;
}) {
  const flow = flowIsConfigured();
  const open = isSubscriptionOpen(subscription);
  const needsCard = Boolean(flow && subscription?.status === "TRIAL" && !subscription.flowSubscriptionId);
  let label = "Activar prueba de 14 días";
  if (needsCard) label = "Registrar tarjeta en Flow";
  else if (flow && !subscription) label = "Empezar prueba de 14 días";
  else if (flow) label = "Suscribir con Flow";

  return (
    <div className="stack">
      <SubscriptionBadge subscription={subscription} />
      {open && !needsCard ? null : (
        <form action={activateTrialAction}>
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="back" value={back} />
          <button className="button small" type="submit">
            {label}
          </button>
        </form>
      )}
      {flow && subscription?.flowSubscriptionId ? (
        <form action={activateTrialAction}>
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="back" value={back} />
          <button className="button secondary small" type="submit">
            Tarjeta en Flow
          </button>
        </form>
      ) : null}
      {open ? (
        <form action={cancelSubscriptionAction}>
          <input type="hidden" name="agent" value={agent} />
          <input type="hidden" name="back" value={back} />
          <button className="button secondary small" type="submit">
            Cancelar
          </button>
        </form>
      ) : null}
    </div>
  );
}
