import Link from "next/link";
import { AGENT_CATALOG, AGENT_ORDER, type AgentId, type MetricId } from "@/lib/catalog";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

const HREF: Record<AgentId, string> = {
  WHATSAPP: "/panel/whatsapp",
  QUOTES: "/panel/cotizador",
  MARKETING: "/panel/marketing",
};

export default async function PanelHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [subscriptions, usage] = await Promise.all([
    prisma.subscription.findMany({ where: { organizationId: session.organizationId } }),
    usageSnapshot(session.organizationId),
  ]);
  const byAgent = new Map(subscriptions.map((item) => [item.agent, item]));

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Panel</p>
          <h1>Hola, {session.name.split(" ")[0]}.</h1>
          <p className="muted">
            {session.organizationName} · uso de {usage.label}
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      <div className="grid-3">
        {AGENT_ORDER.map((agentId) => {
          const agent = AGENT_CATALOG[agentId];
          const subscription = byAgent.get(agentId) ?? null;
          const metrics = Object.entries(agent.limits) as [MetricId, number][];
          return (
            <article className="panel-card stack" key={agentId}>
              <h2>{agent.name}</h2>
              <p>{agent.tagline}</p>
              <p className="muted">
                {formatClp(agent.priceClp)} neto / mes + IVA · {agent.limitLabel}
              </p>
              <SubscribeActions agent={agentId} back="/panel" subscription={subscription} />
              {metrics.map(([metric, limit]) => (
                <UsageBar key={metric} used={usage.totals[metric]} limit={limit} label={metric === "RESPONSES" ? "Respuestas" : metric === "QUOTES" ? "Cotizaciones" : metric === "TEXTS" ? "Textos" : "Imágenes"} />
              ))}
              <div className="inline">
                <Link className="button-link small secondary" href={HREF[agentId]}>
                  Abrir
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
