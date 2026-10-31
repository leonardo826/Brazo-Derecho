import Link from "next/link";
import { saveOnboardingCompanyAction } from "@/app/actions/onboarding";
import { activateTrialAction } from "@/app/actions/subscriptions";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { PaymentProviderField } from "@/components/payment-provider-field";
import { AGENT_CATALOG, AGENT_ORDER, isAgentId, type AgentId } from "@/lib/catalog";
import { flowIsTestMode, mercadoPagoIsTestMode } from "@/lib/payments/mode";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

const HREF: Record<AgentId, string> = {
  WHATSAPP: "/panel/whatsapp",
  QUOTES: "/panel/cotizador",
  MARKETING: "/panel/marketing",
};

const STEPS = [
  { id: "empresa", label: "1. Tu empresa" },
  { id: "agente", label: "2. El agente" },
  { id: "probar", label: "3. La prueba" },
] as const;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const requested = firstParam(params.paso);
  const step = requested === "agente" || requested === "probar" ? requested : "empresa";
  const agentRaw = firstParam(params.agente) ?? "";
  const agent = isAgentId(agentRaw) ? agentRaw : null;
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: session.organizationId } });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Primeros pasos</p>
          <h1>Deja listo tu primer agente</h1>
          <p className="muted">
            Son tres pasos. No pedimos tarjeta. Sin claves de servicios, el agente responde en el simulador y no sale nada a un celular ni a una red.
          </p>
        </div>
      </div>
      <ol className="wizard-steps" aria-label="Pasos">
        {STEPS.map((item) => (
          <li key={item.id} className={item.id === step ? "current" : undefined} aria-current={item.id === step ? "step" : undefined}>
            {item.label}
          </li>
        ))}
      </ol>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />

      {step === "empresa" ? (
        <form action={saveOnboardingCompanyAction} className="panel-card stack">
          <CsrfField />
          <h2>Datos de la empresa</h2>
          <p className="muted">
            El nombre es el que ven tus clientes cuando el agente se presenta. El RUT es opcional en la beta y queda solo en tu cuenta.
          </p>
          <label>
            Nombre del negocio
            <input name="organizationName" required minLength={2} maxLength={120} defaultValue={organization.name} />
          </label>
          <label>
            RUT de la empresa (opcional)
            <input name="rut" maxLength={20} defaultValue={organization.rut ?? ""} placeholder="76.123.456-0" />
          </label>
          <button className="button" type="submit">
            Seguir
          </button>
        </form>
      ) : null}

      {step === "agente" ? (
        <section className="stack">
          <div>
            <h2>Elige con cuál partir</h2>
            <p className="muted">Cada agente se activa por separado, con su propia prueba de 14 días. Los otros los puedes abrir después.</p>
          </div>
          <div className="choice-grid">
            {AGENT_ORDER.map((agentId) => {
              const item = AGENT_CATALOG[agentId];
              return (
                <Link key={agentId} className="choice" href={`/panel/empezar?paso=probar&agente=${agentId}`}>
                  <strong>{item.name}</strong>
                  <span>{item.tagline}</span>
                  <span className="muted">
                    {formatClp(item.priceClp)} neto al mes, más IVA, después de la prueba · {item.limitLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {step === "probar" ? (
        <article className="panel-card stack">
          {agent ? (
            <>
              <h2>Prueba {AGENT_CATALOG[agent].name} por 14 días</h2>
              <p>{AGENT_CATALOG[agent].tagline}</p>
              <ul className="plain">
                {AGENT_CATALOG[agent].does.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <ul className="plain no">
                {AGENT_CATALOG[agent].doesNot.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="muted">
                En la beta no hay cobro. Elige con qué medio vas a pagar el plan. Flow queda marcado. Si ese medio está en modo prueba, no pedimos tarjeta.
              </p>
              <form action={activateTrialAction} className="stack">
                <CsrfField />
                <PaymentProviderField flowTest={flowIsTestMode()} mercadoPagoTest={mercadoPagoIsTestMode()} />
                <input type="hidden" name="agent" value={agent} />
                <input type="hidden" name="back" value={HREF[agent]} />
                <input type="hidden" name="guia" value="1" />
                <button className="button" type="submit">
                  Activar prueba y probar
                </button>
              </form>
              <p>
                <Link href="/panel/empezar?paso=agente">Elegir otro agente</Link>
              </p>
            </>
          ) : (
            <>
              <h2>Falta elegir el agente</h2>
              <p>Elige uno para activar la prueba de 14 días.</p>
              <Link className="button-link" href="/panel/empezar?paso=agente">
                Ver los agentes
              </Link>
            </>
          )}
        </article>
      ) : null}
    </>
  );
}
