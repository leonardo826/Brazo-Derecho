import { AGENT_CATALOG, AGENT_ORDER, METRIC_LABEL, type MetricId } from "@/lib/catalog";
import { Flash } from "@/components/flash";
import { UsageBar } from "@/components/usage-bar";
import { formatClp, formatUsd } from "@/lib/format";
import { companyMeter } from "@/lib/meter-store";
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
  const meter = await companyMeter(session.organizationId);
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
        <h2>Consumo para cobro</h2>
        <p>
          Tareas completadas: <strong>{meter.tasks.toLocaleString("es-CL")}</strong>
        </p>
        <p>
          Tokens del mes: {meter.tokens.inputTokens.toLocaleString("es-CL")} de entrada,{" "}
          {meter.tokens.cachedTokens.toLocaleString("es-CL")} en caché,{" "}
          {meter.tokens.outputTokens.toLocaleString("es-CL")} de salida. De la API:{" "}
          {meter.apiTokens.inputTokens.toLocaleString("es-CL")} de entrada,{" "}
          {meter.apiTokens.cachedTokens.toLocaleString("es-CL")} en caché,{" "}
          {meter.apiTokens.outputTokens.toLocaleString("es-CL")} de salida.
        </p>
        {meter.simulatorTokens.inputTokens + meter.simulatorTokens.outputTokens > 0 ? (
          <p>
            El simulador anotó {meter.simulatorTokens.inputTokens.toLocaleString("es-CL")} de entrada,{" "}
            {meter.simulatorTokens.cachedTokens.toLocaleString("es-CL")} en caché y{" "}
            {meter.simulatorTokens.outputTokens.toLocaleString("es-CL")} de salida. Esos tokens quedan marcados y no
            entran en el costo real.
          </p>
        ) : null}
        <p>
          Costo real estimado: {formatUsd(meter.xaiUsd)} de xAI y {formatUsd(meter.computerUsd)} de computador en la
          nube.
        </p>
        <p className="price">
          {formatClp(meter.clientClp)} <small>estimado, el doble del costo real</small>
        </p>
        {meter.fixedPriceClp != null ? (
          <p>El precio fijo de la vitrina sigue en {formatClp(meter.fixedPriceClp)} + IVA al mes. Este estimado no lo reemplaza.</p>
        ) : null}
        <p className="muted">
          No es un cobro. Mercado Pago sigue con el monto fijo del plan. Las tarifas de grok-4.3 y grok-4.7 son
          constantes: hay que refrescarlas desde docs.x.ai. El dólar de este cálculo ({meter.fx.toLocaleString("es-CL")}{" "}
          pesos) no es el tipo de cambio del día.
        </p>
      </article>
      <article className="panel-card" style={{ marginTop: "1rem" }}>
        <h2>Estimación de IA</h2>
        <p className="price">
          {formatClp(usage.costClp)} <small>este mes, estimado</small>
        </p>
        <h3>Tokens del cupo</h3>
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
          Con la API de xAI, estos números salen de cada respuesta y quedan guardados en tu empresa. Sin la clave de xAI, el
          simulador anota una estimación. No es un cobro. Supuestos del 29 de octubre de 2026: grok-4.3 a US$1,25 /
          US$0,20 en caché / US$2,50 la salida; grok-4.7 a US$2 / US$0,50 / US$6; imagen a US$0,04; dólar a $
          {FX_CLP_PER_USD.toLocaleString("es-CL")}.
        </p>
      </article>
    </>
  );
}
