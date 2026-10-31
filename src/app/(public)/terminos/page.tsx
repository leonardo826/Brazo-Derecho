import type { Metadata } from "next";

export const metadata: Metadata = { title: "Términos" };

export default function TermsPage() {
  return (
    <article className="legal">
      <p className="eyebrow">Borrador de la beta</p>
      <h1>Términos de la beta</h1>
      <p>
        Esto no es un contrato de suscripción. Es la regla de uso de esta versión de prueba. Antes del primer cobro
        tiene que revisarlo un abogado.
      </p>
      <h2>Qué estás probando</h2>
      <p>
        Un panel para tres agentes: Atención WhatsApp, Cotizador y Marketing. La prueba dura 14 días. Los precios
        publicados son netos, más IVA. Al crear la cuenta queda registrada la fecha en que aceptaste estos términos y
        el aviso de privacidad.
      </p>
      <h2>Qué no hace el servicio</h2>
      <p>
        No cobra, no promete descuentos, no da asesoría legal ni médica, no publica en redes, no envía cotizaciones y no
        emite boleta ni factura. Esas decisiones las toma una persona de tu empresa.
      </p>
      <h2>Tu información manda</h2>
      <p>
        El cotizador usa solo tu lista de precios. La atención usa solo tu base de conocimiento y, si no encuentra,
        deja el mensaje para una persona. No debes cargar datos que no tengas derecho a tratar.
      </p>
      <h2>Límites</h2>
      <p>
        Atención WhatsApp: 1.000 respuestas al mes. Cotizador: 300 cotizaciones. Marketing: 60 textos y 30 imágenes. Al
        llegar al límite, el agente se detiene hasta el mes siguiente.
      </p>
      <h2>Cuenta</h2>
      <p>
        Eres responsable de la contraseña y de lo que suba tu equipo. La beta puede borrar datos de demostración o
        cambiar sin aviso.
      </p>
    </article>
  );
}
