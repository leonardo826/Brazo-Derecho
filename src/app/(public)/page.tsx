import Link from "next/link";
import type { Metadata } from "next";
import { AGENT_CATALOG, AGENT_ORDER } from "@/lib/catalog";
import { formatClp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Tu brazo derecho, con reglas claras",
};

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Para pymes en Chile</p>
            <h1>Tu brazo derecho, con reglas claras.</h1>
            <p className="lead">
              Tres agentes para atender por WhatsApp, armar cotizaciones y preparar las redes. Trabajan con la
              información de tu empresa. No inventan precios, no cobran y no publican solos.
            </p>
            <div className="actions">
              <Link className="button-link" href="/registro">
                Crear la cuenta de mi empresa
              </Link>
              <Link className="button-link secondary" href="/ingresar">
                Ya tengo cuenta
              </Link>
            </div>
            <ul className="trust">
              <li>Datos separados por empresa</li>
              <li>Límites de uso al mes</li>
              <li>Tú apruebas antes de enviar</li>
            </ul>
          </div>
          <aside className="chat-card" aria-label="Ejemplo de atención">
            <header>
              <strong>Atención WhatsApp</strong>
              <span className="badge">Simulador</span>
            </header>
            <div className="bubble customer">
              <span className="who">Cliente</span>
              <p>Hola, ¿a qué hora abren el sábado?</p>
            </div>
            <div className="bubble agent">
              <span className="who">Agente</span>
              <p>Te cuento sobre el horario: de lunes a viernes de 9:00 a 19:00 y el sábado de 9:00 a 14:00.</p>
            </div>
            <div className="bubble customer">
              <span className="who">Cliente</span>
              <p>¿Me haces un descuento si llevo diez?</p>
            </div>
            <div className="bubble agent">
              <span className="who">Agente</span>
              <p>No puedo ofrecer descuentos ni cambiar precios. Si quieres un valor distinto, te deriva una persona.</p>
            </div>
            <p className="fine">En la beta el mensaje no sale a un celular. Sirve para probar las reglas.</p>
          </aside>
        </div>
      </section>

      <section className="section" id="agentes">
        <div className="wrap">
          <p className="eyebrow">Los tres agentes</p>
          <h2>Se contratan por separado.</h2>
          <p className="lead">
            Parte por el que hoy te quita más tiempo. Cada uno tiene un techo de uso para que el gasto no se dispare. El detalle, lo que no hacen y las preguntas están en el{" "}
            <Link href="/agentes">catálogo</Link> y en <Link href="/precios">precios</Link>.
          </p>
          <div className="grid-3" id="precios">
            {AGENT_ORDER.map((id) => {
              const agent = AGENT_CATALOG[id];
              return (
                <article className="card" key={id}>
                  <p className="eyebrow">{agent.model}</p>
                  <h3>{agent.name}</h3>
                  <p>{agent.tagline}</p>
                  <p className="price">
                    {formatClp(agent.priceClp)} <small>neto al mes, más IVA</small>
                  </p>
                  <p className="muted">{agent.limitLabel}</p>
                  <ul className="plain">
                    {agent.does.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <ul className="plain no">
                    {agent.doesNot.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Cómo parte</p>
          <h2>Cuatro pasos, sin tarjeta en la beta.</h2>
          <div className="steps">
            <article className="step">
              <b>1</b>
              <h3>Crea tu empresa</h3>
              <p>Correo y contraseña. Los datos quedan marcados con tu empresa.</p>
            </article>
            <article className="step">
              <b>2</b>
              <h3>Activa una prueba</h3>
              <p>14 días por agente. Si el cobro con Flow o Mercado Pago está activo, después se cobra el plan. Si no, la prueba no tiene cargo.</p>
            </article>
            <article className="step">
              <b>3</b>
              <h3>Sube tu información</h3>
              <p>Preguntas frecuentes, lista de precios o el perfil de marca.</p>
            </article>
            <article className="step">
              <b>4</b>
              <h3>Revisa antes de salir</h3>
              <p>La cotización queda en PDF. El texto de redes queda en borrador.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section faq">
        <div className="wrap">
          <p className="eyebrow">Preguntas</p>
          <h2>Qué hace esta beta y qué no.</h2>
          <details>
            <summary>¿Cómo se conecta WhatsApp?</summary>
            <p>
              En el panel puedes probar con el simulador, con las mismas reglas del canal. Si vinculas el id del número
              y está configurada la API de Meta, los mensajes de esa línea llegan al agente de Atención WhatsApp de esa
              empresa. La respuesta indica que es un asistente virtual.
            </p>
          </details>
          <details>
            <summary>¿Quién redacta la respuesta?</summary>
            <p>
              La atención usa la ficha de tu empresa y, si no encuentra el dato, deriva a una persona. El precio de una
              cotización sale solo de tu lista. Si la API de xAI está conectada, el texto lo redacta grok-4.3 en la
              atención y grok-4.7 en cotizaciones y marketing, y los tokens quedan anotados en tu empresa. Si no está
              conectada, el mismo texto lo arma el simulador, con el límite del mes igual de firme.
            </p>
          </details>
          <details>
            <summary>¿Puedo ver los datos de otra empresa?</summary>
            <p>No. Cada consulta del panel filtra por la empresa de tu sesión. Otra cuenta no ve tu lista ni tus hilos.</p>
          </details>
          <details>
            <summary>¿Cómo se va a cobrar?</summary>
            <p>
              Cada agente tiene un plan mensual en pesos chilenos, neto, más IVA. La prueba dura 14 días. Con Flow o
              Mercado Pago activo, registras la tarjeta y el aviso de pago deja el agente activo o lo detiene. Si ese
              medio no está conectado, la prueba se activa en el panel y no hay cargo. La boleta electrónica sigue pendiente.
            </p>
          </details>
        </div>
      </section>
    </>
  );
}
