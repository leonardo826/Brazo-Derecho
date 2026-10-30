import { AGENT_CATALOG, AGENT_ORDER, METRIC_LABEL, type MetricId } from "@/lib/catalog";
import { Flash } from "@/components/flash";
import { UsageBar } from "@/components/usage-bar";
import { formatClp } from "@/lib/format";
import { FX_CLP_PER_USD } from "@/lib/pricing";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const usage = await usageSnapshot(session.organizationId);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Control de uso</p>
          <h1>Uso de {usage.label}</h1>
          <p className="muted">
            El mes se cuenta en hora de Chile. Al llegar al límite, el agente se detiene.
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
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
        <h3>Tokens del mes</h3>
        <p>
          grok-4.3, tareas habituales: {usage.byModel["grok-4.3"].inputTokens.toLocaleString("es-CL")} de entrada,{" "}
          {usage.byModel["grok-4.3"].cachedTokens.toLocaleString("es-CL")} en caché,{" "}
          {usage.byModel["grok-4.3"].outputTokens.toLocaleString("es-CL")} de salida.
        </p>
        <p>
          grok-4.7, tareas complejas: {usage.byModel["grok-4.7"].inputTokens.toLocaleString("es-CL")} de entrada,{" "}
          {usage.byModel["grok-4.7"].cachedTokens.toLocaleString("es-CL")} en caché,{" "}
          {usage.byModel["grok-4.7"].outputTokens.toLocaleString("es-CL")} de salida.
        </p>
        <p className="muted">
          Con la API de xAI, estos números salen de cada respuesta y quedan guardados en tu empresa. Sin la clave, el
          simulador anota una estimación. No es un cobro. Supuestos del 29 de octubre de 2026: grok-4.3 a US$1,25 /
          US$0,20 en caché / US$2,50 la salida; grok-4.7 a US$2 / US$0,50 / US$6; imagen a US$0,04; dólar a $
          {FX_CLP_PER_USD.toLocaleString("es-CL")}.
        </p>
      </article>
    </>
  );
}
