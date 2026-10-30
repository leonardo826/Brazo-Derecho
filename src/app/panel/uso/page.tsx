import { AGENT_CATALOG, AGENT_ORDER, METRIC_LABEL, type MetricId } from "@/lib/catalog";
import { UsageBar } from "@/components/usage-bar";
import { formatClp } from "@/lib/format";
import { FX_CLP_PER_USD } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

export default async function UsagePage() {
  const session = await requireSession();
  const usage = await usageSnapshot(session.organizationId);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Control de uso</p>
          <h1>Uso de {usage.label}</h1>
          <p className="muted">
            El mes se cuenta en hora de Chile. Al llegar al límite, el agente se detiene. No hay cobro automático en la
            beta.
          </p>
        </div>
      </div>
      <div className="grid-3">
        {AGENT_ORDER.map((agentId) => {
          const agent = AGENT_CATALOG[agentId];
          const metrics = Object.entries(agent.limits) as [MetricId, number][];
          return (
            <article className="panel-card stack" key={agentId}>
              <h2>{agent.name}</h2>
              {metrics.map(([metric, limit]) => (
                <UsageBar key={metric} label={METRIC_LABEL[metric]} used={usage.totals[metric]} limit={limit} />
              ))}
            </article>
          );
        })}
      </div>
      <article className="panel-card" style={{ marginTop: "1rem" }}>
        <h2>Estimación de IA</h2>
        <p className="price">
          {formatClp(usage.costClp)} <small>este mes, estimado</small>
        </p>
        <p className="muted">
          No es un cobro. Usa los supuestos del 29 de octubre de 2026: grok-4.3 a US$1,25 / US$0,20 en caché / US$2,50
          la salida; grok-4.7 a US$2 / US$0,50 / US$6; imagen a US$0,04; dólar a ${FX_CLP_PER_USD.toLocaleString("es-CL")}.
          El cliente de esta beta es simulado y no consulta la tarifa en vivo.
        </p>
      </article>
    </>
  );
}
