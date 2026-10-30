import type { Metadata } from "next";
import { Marked } from "@/components/marked-text";

export const metadata: Metadata = { title: "Aviso de privacidad" };

export default function PrivacyPage() {
  return (
    <article className="legal">
      <p className="eyebrow">Borrador para revisión</p>
      <h1>Aviso de privacidad</h1>
      <p className="banner ok">
        Los campos entre corchetes están pendientes. Se dejan marcados a propósito hasta completarlos antes de publicar
        el texto definitivo.
      </p>
      <p>
        <Marked text="Borrador preparado el 30 de octubre de 2026. Basado en la Ley 19.628 y su reforma por la Ley 21.719 (entrada en vigencia plena prevista para diciembre de 2026, NO VERIFICADO: confirmar fecha en bcn.cl). Completar los campos [entre corchetes] antes de publicar." />
      </p>

      <h2>1. Quiénes somos</h2>
      <p>
        <Marked text='[Razón social], RUT [__], con domicilio en [__], Chile ("Brazo Derecho"), es responsable del tratamiento de los datos personales que se recopilan a través de [dominio] y de los agentes virtuales que ofrecemos.' />
      </p>
      <p>
        <Marked text="Contacto para temas de privacidad: [correo de privacidad]." />
      </p>

      <h2>2. Qué datos tratamos</h2>
      <ul>
        <li>
          <strong>Datos de tu cuenta:</strong> nombre, correo, teléfono, empresa, RUT de facturación.
        </li>
        <li>
          <strong>Datos de pago:</strong> los procesa Flow (u otra pasarela). Brazo Derecho no guarda números de tarjeta.
        </li>
        <li>
          <strong>Contenido que entregas a los agentes:</strong> mensajes, documentos, listas de precios, información de tu
          negocio.
        </li>
        <li>
          <strong>Datos de tus clientes finales:</strong> cuando usas el agente de Atención WhatsApp, recibimos nombres,
          números y mensajes de las personas que te escriben. En ese caso tú eres el responsable de esos datos y Brazo
          Derecho actúa como encargado del tratamiento por cuenta tuya.
        </li>
        <li>
          <strong>Datos de uso:</strong> registros técnicos, consumo de mensajes, fecha y hora de acceso.
        </li>
      </ul>

      <h2>3. Para qué los usamos</h2>
      <ol>
        <li>Prestar el servicio contratado y operar tus agentes.</li>
        <li>Cobrar la suscripción y emitir boletas o facturas.</li>
        <li>Darte soporte y avisarte de cambios importantes.</li>
        <li>Controlar el uso, prevenir abusos y mantener la seguridad.</li>
        <li>Mejorar el servicio con datos agregados o anonimizados.</li>
      </ol>
      <p>No vendemos tus datos ni los de tus clientes.</p>

      <h2>4. Base legal</h2>
      <p>
        Ejecución del contrato (términos del servicio), cumplimiento de obligaciones legales y tributarias, y tu
        consentimiento cuando corresponda (por ejemplo, comunicaciones comerciales, que puedes rechazar en cualquier
        momento).
      </p>

      <h2>5. Con quién los compartimos (proveedores)</h2>
      <ul>
        <li>
          <strong>xAI</strong> (procesamiento de lenguaje para que los agentes respondan), en Estados Unidos.
        </li>
        <li>
          <strong>Proveedor de WhatsApp</strong> (Meta), para enviar y recibir mensajes.
        </li>
        <li>
          <Marked text="Flow (pagos) y [proveedor de hosting y base de datos]." />
        </li>
        <li>
          <Marked text="Servicio de facturación electrónica [por definir]." />
        </li>
      </ul>
      <p>
        Algunos proveedores están fuera de Chile, lo que implica transferencia internacional de datos. Exigimos a cada
        proveedor resguardos de seguridad y confidencialidad.
      </p>

      <h2>6. Cuánto tiempo los guardamos</h2>
      <p>
        <Marked text="Mientras tengas cuenta activa y hasta [__] meses después de terminarla, salvo los datos que la ley tributaria obliga a conservar por más tiempo." />
      </p>

      <h2>7. Tus derechos</h2>
      <p>
        <Marked text="Puedes pedir acceso, rectificación, supresión, oposición, portabilidad y bloqueo de tus datos escribiendo a [correo de privacidad]. Responderemos dentro de los plazos legales. Si no quedas conforme, puedes recurrir a la Agencia de Protección de Datos Personales." />
      </p>

      <h2>8. Seguridad</h2>
      <p>
        Usamos conexiones cifradas, acceso restringido y separación de datos entre clientes. Si ocurre una vulneración
        que afecte tus datos, te avisaremos y avisaremos a la autoridad según exige la ley.
      </p>

      <h2>9. Uso de inteligencia artificial</h2>
      <p>
        Las respuestas de los agentes las genera un sistema de inteligencia artificial y pueden contener errores.
        Recomendamos revisar cotizaciones y piezas de marketing antes de enviarlas. Los mensajes de WhatsApp indican que
        la persona está conversando con un asistente virtual.
      </p>

      <h2>10. Cambios</h2>
      <p>Si cambiamos este aviso, te lo informaremos por correo o en tu panel antes de que entre en vigencia.</p>
      <p>
        <Marked text="Última actualización: [fecha]" />
      </p>
    </article>
  );
}
