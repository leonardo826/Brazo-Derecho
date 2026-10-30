import Link from "next/link";
import { confirmMockPaymentAction } from "@/app/actions/subscriptions";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { AGENT_CATALOG, isAgentId } from "@/lib/catalog";
import { flowIsConfigured } from "@/lib/flow/client";
import { canActivateMockPlan } from "@/lib/flow/mock-checkout";
import { planFor } from "@/lib/flow/plans";
import { formatClp } from "@/lib/format";
import { paymentReturnPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const back = paymentReturnPath(firstParam(params.volver));
  const agentRaw = firstParam(params.agente) ?? "";
  const agent = isAgentId(agentRaw) ? agentRaw : null;
  const flow = flowIsConfigured();
  const subscription = agent
    ? await prisma.subscription.findUnique({
        where: { organizationId_agent: { organizationId: session.organizationId, agent } },
      })
    : null;
  const ready = Boolean(agent && !flow && canActivateMockPlan(subscription));
  const plan = agent ? planFor(agent) : null;
  const catalog = agent ? AGENT_CATALOG[agent] : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Pago de prueba</p>
          <h1>Pago de prueba</h1>
          <p className="muted">Esta pantalla simula el checkout de Flow. No es un cobro real.</p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      <article className="panel-card stack">
        <p className="banner warn">Pago de prueba. No se cobra, no pedimos tarjeta y no sale ningún dato de este computador.</p>
        {catalog && plan ? (
          <>
            <h2>{catalog.name}</h2>
            <p>{catalog.tagline}</p>
            <p className="price">
              {formatClp(plan.amountClp)} <small>con IVA / mes</small>
            </p>
            <p className="muted">
              {formatClp(plan.netClp)} neto + IVA. En el simulador ese monto queda anotado y no se envía a Flow.
            </p>
          </>
        ) : (
          <p>Elige un agente desde el panel para ver el pago de prueba.</p>
        )}
        {flow ? (
          <p>Flow está configurado en este servidor. El pago de prueba no se usa: el cobro lo hace Flow.</p>
        ) : null}
        {!flow && agent && !ready ? (
          <p>Primero activa la prueba de 14 días. Desde ahí puedes pasar al plan con este pago de prueba.</p>
        ) : null}
        {ready && agent ? (
          <form action={confirmMockPaymentAction} className="inline">
            <CsrfField />
            <input type="hidden" name="agent" value={agent} />
            <input type="hidden" name="back" value={back} />
            <button className="button" type="submit">
              Confirmar pago de prueba
            </button>
            <Link className="button-link secondary" href={`${back}?ok=pago_cancelado`}>
              Cancelar
            </Link>
          </form>
        ) : (
          <p>
            <Link className="button-link secondary" href={back}>
              Volver al panel
            </Link>
          </p>
        )}
      </article>
    </>
  );
}
