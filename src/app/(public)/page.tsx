import Link from "next/link";
import type { Metadata } from "next";
import { formatClp } from "@/lib/format";
import { iabotPriceClp, TRIAL_DAYS } from "@/lib/subscription";

export const metadata: Metadata = {
  title: { absolute: "IA Bot" },
  description: "IA Bot responde tu WhatsApp, cotiza, cobra y te ordena el día. Tú solo apruebas.",
};

const FUNCTIONS = [
  "WhatsApp 24/7",
  "Cotizaciones y cierre",
  "Correo ordenado",
  "Agenda y resumen diario",
  "Minutas",
  "Cobranza y documentos para tu contador",
  "Proveedores, stock y despachos",
  "Equipo y turnos",
  "Clientes y reseñas",
] as const;

const STEPS = [
  "Conversa 10 minutos con IA Bot",
  "Sube tu catálogo y precios",
  "Conecta tu WhatsApp Business",
] as const;

export default function HomePage() {
  const price = iabotPriceClp();
  const cta = `Probar gratis ${TRIAL_DAYS} días`;
  return (
    <div className="iabot">
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <header className="iabot-header">
        <div className="iabot-wrap iabot-bar">
          <Link className="iabot-logo" href="/">
            <span className="iabot-mark" aria-hidden="true" />
            IA Bot
          </Link>
          <Link className="iabot-account" href="/ingresar">
            Ya tengo cuenta
          </Link>
        </div>
      </header>
      <main id="contenido">
        <section className="iabot-hero">
          <div className="iabot-wrap">
            <p className="iabot-badge">{TRIAL_DAYS} días gratis</p>
            <h1>Tu oficina, ordenada por IA.</h1>
            <p className="iabot-lead">
              IA Bot responde tu WhatsApp, cotiza, cobra y te ordena el día. Tú solo apruebas.
            </p>
            <Link className="iabot-cta" href="/registro">
              {cta}
            </Link>
            <p className="iabot-note">Sin compromiso. Cancelas cuando quieras.</p>
          </div>
        </section>

        <section className="iabot-section" aria-labelledby="que-hace">
          <div className="iabot-wrap">
            <h2 id="que-hace">Qué hace</h2>
            <ul className="iabot-functions">
              {FUNCTIONS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="iabot-control" aria-labelledby="control">
          <div className="iabot-wrap">
            <p className="iabot-kicker">Tú tienes el control</p>
            <h2 id="control">Nada sensible sale sin tu aprobación.</h2>
          </div>
        </section>

        <section className="iabot-section" aria-labelledby="como">
          <div className="iabot-wrap">
            <h2 id="como">Cómo empiezas</h2>
            <ol className="iabot-steps">
              {STEPS.map((step, index) => (
                <li key={step}>
                  <span aria-hidden="true">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="iabot-section iabot-plan-section" aria-labelledby="plan">
          <div className="iabot-wrap iabot-plan">
            <h2 id="plan">IA Bot Profesional — todo incluido.</h2>
            {price == null ? (
              <p className="iabot-soon">Precio de lanzamiento: pronto</p>
            ) : (
              <p className="iabot-price">
                {formatClp(price)} <span>al mes, IVA incluido</span>
              </p>
            )}
            <Link className="iabot-cta" href="/registro">
              {cta}
            </Link>
          </div>
        </section>
      </main>
      <footer className="iabot-footer">
        <div className="iabot-wrap iabot-bar">
          <p>IA Bot</p>
          <nav aria-label="Legal">
            <Link href="/terminos">Términos</Link>
            <Link href="/privacidad">Privacidad</Link>
            <Link href="/ingresar">Ingresar</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
