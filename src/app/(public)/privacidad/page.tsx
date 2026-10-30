import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacidad" };

export default function PrivacyPage() {
  return (
    <article className="legal">
      <p className="eyebrow">Borrador de la beta</p>
      <h1>Privacidad</h1>
      <p>
        Este texto no reemplaza una revisión de abogado. Sirve para dejar claro cómo trata los datos esta beta, antes
        de la Ley 21.719 y del contrato con cada cliente.
      </p>
      <h2>Quién es quién</h2>
      <p>
        La empresa que crea la cuenta es responsable de los datos de sus clientes finales (teléfonos de prueba, nombres
        en cotizaciones, textos de redes). Brazo Derecho, en esta beta, los guarda para prestar el panel y actúa como
        encargado del tratamiento.
      </p>
      <h2>Qué se guarda</h2>
      <p>
        Correo, nombre, contraseña cifrada, nombre y RUT opcional de la empresa, base de conocimiento, lista de precios,
        cotizaciones, borradores de marketing y el uso del mes. La contraseña no se guarda en texto plano.
      </p>
      <h2>Dónde</h2>
      <p>
        En la base Postgres que configures con <code>DATABASE_URL</code>. La beta no envía esos datos a la API de xAI:
        el cliente está simulado y no abre una conexión.
      </p>
      <h2>Separación</h2>
      <p>
        Cada fila de negocio queda marcada con la empresa. El panel solo muestra la empresa de tu sesión. Cerrar sesión
        borra la cookie httpOnly.
      </p>
      <h2>WhatsApp</h2>
      <p>
        El simulador no habla con Meta ni con un teléfono. Cuando exista el canal real, habrá que avisar a la persona
        que escribe que está hablando con un agente y cómo pedir a un humano.
      </p>
    </article>
  );
}
