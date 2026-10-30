import Link from "next/link";
import { AGENT_CATALOG, AGENT_ORDER } from "@/lib/catalog";
import { formatClp } from "@/lib/format";
import { priceWithIva } from "@/lib/flow/plans";
import { TRIAL_DAYS } from "@/lib/subscription";

const PLANS = AGENT_ORDER.map((id) => {
  const agent = AGENT_CATALOG[id];
  return { ...agent, grossClp: priceWithIva(agent.priceClp) };
});

export function PublicCatalog({ emphasis }: { emphasis: "agentes" | "precios" }) {
  const pricesFirst = emphasis === "precios";
  return (
    <>
      <section className="hero">
        <div className="wrap hero-copy">
          <p className="eyebrow">{pricesFirst ? "Precios" : "Catálogo"}</p>
          <h1>{pricesFirst ? "Precios claros, en pesos chilenos." : "Tres agentes, cada uno con su trabajo."}</h1>
          <p className="lead">
            Atención WhatsApp, Cotizador y Marketing se contratan por separado. Los precios son netos, más IVA de 19%.
            La prueba dura {TRIAL_DAYS} días. Sin cobro conectado, la prueba queda en el panel y no hay cargo.
          </p>
          <div className="actions">
            <Link className="button-link" href="/registro">
              Crear cuenta y probar {TRIAL_DAYS} días
            </Link>
            <Link className="button-link secondary" href={pricesFirst ? "/agentes" : "/precios"}>
              {pricesFirst ? "Ver qué hace cada uno" : "Ver precios"}
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id={pricesFirst ? "precios" : "agentes"}>
        <div className="wrap">
          <p className="eyebrow">{pricesFirst ? "Planes mensuales" : "Qué hace y qué no hace"}</p>
          <h2>{pricesFirst ? "Un precio por agente, después de la prueba." : "Cada agente tiene un límite y un no."}</h2>
          <div className="grid-3">
            {PLANS.map((agent) => (
              <article className="card" key={agent.id}>
                <p className="eyebrow">{agent.limitLabel}</p>
                <h3>{agent.name}</h3>
                <p>{agent.tagline}</p>
                <p className="price">
                  {formatClp(agent.priceClp)} <small>neto / mes + IVA</small>
                </p>
                <p className="muted">
                  {formatClp(agent.grossClp)} con IVA · prueba de {TRIAL_DAYS} días
                </p>
                <h4>Qué hace</h4>
                <ul className="plain">
                  {agent.does.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <h4>Qué no hace</h4>
                <ul className="plain no">
                  {agent.doesNot.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section faq" id="preguntas">
        <div className="wrap">
          <p className="eyebrow">Preguntas</p>
          <h2>Antes de crear la cuenta.</h2>
          <details>
            <summary>¿Puedo contratar un solo agente?</summary>
            <p>
              Sí. Cada uno se activa por separado, con su propia prueba de {TRIAL_DAYS} días. Puedes partir por el que
              hoy te quita más tiempo y abrir los otros después.
            </p>
          </details>
          <details>
            <summary>¿Los precios incluyen IVA?</summary>
            <p>
              No. Los precios publicados son netos. El IVA es 19%, así que Atención WhatsApp queda en{" "}
              {formatClp(PLANS[0].grossClp)}, el Cotizador en {formatClp(PLANS[1].grossClp)} y Marketing en{" "}
              {formatClp(PLANS[2].grossClp)}. Ese es el monto mensual que se cobraría con Flow, después de la prueba.
            </p>
          </details>
          <details>
            <summary>¿La prueba de {TRIAL_DAYS} días se cobra?</summary>
            <p>
              No pedimos tarjeta para crear la cuenta. Si Flow está conectado, la tarjeta se registra al activar el
              plan y el cobro parte al terminar la prueba. Si Flow no está conectado, la prueba se activa en el panel
              y no hay cargo. La boleta electrónica sigue pendiente.
            </p>
          </details>
          <details>
            <summary>¿Qué no hace Atención WhatsApp?</summary>
            <p>
              Responde con la ficha de tu empresa, deriva a una persona cuando no tiene el dato y guarda el hilo. No
              cobra, no pide datos de tarjeta, no promete descuentos, no da asesoría legal ni médica y no manda
              publicidad masiva. El tope es {AGENT_CATALOG.WHATSAPP.limitLabel}.
            </p>
          </details>
          <details>
            <summary>¿El cotizador envía la cotización o emite boleta?</summary>
            <p>
              No. Arma la cotización solo con tu lista de precios, calcula el total y deja un PDF para que tú la
              apruebes. No inventa precios, no la envía al cliente y no emite boleta ni factura. El tope es{" "}
              {AGENT_CATALOG.QUOTES.limitLabel}.
            </p>
          </details>
          <details>
            <summary>¿Marketing publica solo?</summary>
            <p>
              No. Prepara textos para Instagram, Facebook, historias y la ficha de Google, y una imagen en borrador. Tú
              publicas. No compra avisos y no responde comentarios. El tope es {AGENT_CATALOG.MARKETING.limitLabel}.
            </p>
          </details>
          <details>
            <summary>¿Los datos de mi empresa se mezclan con los de otra?</summary>
            <p>No. Cada consulta del panel filtra por la empresa de tu sesión. Otra cuenta no ve tu lista ni tus hilos.</p>
          </details>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Crea la cuenta y elige un agente.</h2>
          <p className="lead">
            El asistente de alta pide los datos de la empresa, el agente y la prueba de {TRIAL_DAYS} días. Sin claves
            de servicios, todo queda en el simulador: no sale un mensaje a un teléfono ni a una red.
          </p>
          <Link className="button-link" href="/registro">
            Crear la cuenta de mi empresa
          </Link>
        </div>
      </section>
    </>
  );
}
