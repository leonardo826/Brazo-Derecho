# Paso a real

La beta sigue en simulador mientras falte una clave. Este es el checklist para cobrar y responder de verdad. Lo que dice «dueño» no lo puede hacer el código: es una cuenta, un número o un pago a nombre de la persona.

## Lo que tiene que hacer el dueño

1. **Clave de xAI.** Crear la clave en la consola de xAI y pegarla en `XAI_API_KEY`. Sacar `XAI_MODE=mock` (déjalo vacío). Sin eso el panel sigue en el simulador y no gasta API.
2. **Cuenta de Flow.** Registrarse en [sandbox.flow.cl](https://sandbox.flow.cl) para probar y en [www.flow.cl](https://www.flow.cl) para cobrar. En Mis datos → Integraciones copiar API Key y Secret Key. El aviso de pago del plan tiene que apuntar a `https://TU-DOMINIO/api/flow/confirmacion`. Probar un pago de sandbox antes de pasar a producción.
3. **Cuenta de Mercado Pago.** Crear una aplicación en el panel de desarrolladores. Para probar, usar credenciales de prueba (`MERCADOPAGO_ACCESS_TOKEN` empieza con `TEST-`). Para cobrar, las de producción. El secreto del webhook va en `MERCADOPAGO_WEBHOOK_SECRET`. Al crear la suscripción enviamos `notification_url` = `https://TU-DOMINIO/api/mercadopago/webhook`. `MERCADOPAGO_PUBLIC_KEY` es opcional y el servidor no la usa. Sin access token, Mercado Pago usa el mismo pago de prueba que Flow y no llama a la API.
4. **Número de WhatsApp.** En Meta Business, un número de WhatsApp Cloud API, el token, el id del número, el verify token y el app secret. La URL del webhook es `https://TU-DOMINIO/api/whatsapp`. Después, en Administración, vincular ese id a la empresa. No hay integración con Twilio.
5. **Dominio.** Comprar el dominio y apuntar el DNS a Vercel. `APP_URL` tiene que ser esa URL, con `https`, sin barra final.
6. **Vercel Pro.** El plan Hobby corta las funciones a los 10 segundos. La llamada a xAI espera hasta 45. Hace falta Vercel Pro (o un plan con el mismo tiempo de función) antes de quitar el simulador.

Además, el dueño elige `SESSION_SECRET` (32 caracteres o más, distinta a la del ejemplo), los correos de `ADMIN_EMAILS` y, si quiere correo de verdad, una cuenta de Resend con el dominio verificado. La revisión legal de términos y privacidad también es de él: los textos publicados son un borrador.

## Variables

Copia esto en Vercel. Los valores de ejemplo no son secretos reales.

```bash
DATABASE_URL="postgresql://USUARIO:CLAVE@HOST-POOLER/brazo_derecho"
DIRECT_URL="postgresql://USUARIO:CLAVE@HOST-DIRECTO/brazo_derecho"
SESSION_SECRET="una-frase-larga-distinta-de-al-menos-32-caracteres"
APP_URL="https://TU-DOMINIO"

XAI_API_KEY="clave-de-la-consola-de-xai"
XAI_API_URL="https://api.x.ai/v1"
XAI_MODE=""
XAI_MODEL_ROUTINE="grok-4.3"
XAI_MODEL_COMPLEX="grok-4.7"

FLOW_API_KEY="api-key-de-flow"
FLOW_SECRET_KEY="secret-key-de-flow"
FLOW_API_URL="https://www.flow.cl/api"

MERCADOPAGO_ACCESS_TOKEN="TEST-o-produccion-sin-pegar-una-clave-real"
MERCADOPAGO_WEBHOOK_SECRET="secreto-del-webhook-de-mercadopago"
MERCADOPAGO_PUBLIC_KEY=""

WHATSAPP_TOKEN="token-de-meta"
WHATSAPP_PHONE_NUMBER_ID="id-de-referencia"
WHATSAPP_VERIFY_TOKEN="un-token-que-tu-inventas-y-pegas-en-meta"
WHATSAPP_APP_SECRET="app-secret-de-meta"

ADMIN_EMAILS="dueno@tu-dominio"
SEED_DEMO=""
SENTRY_DSN=""
RESEND_API_KEY="re_..."
RESEND_FROM="Brazo Derecho <hola@TU-DOMINIO>"
```

| Variable | Si queda vacía |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET` | La app no parte o la sesión no se firma. |
| `XAI_API_KEY` o `XAI_MODE=mock` | Simulador. No hay red hacia xAI. |
| `FLOW_API_KEY` o `FLOW_SECRET_KEY` | La prueba de 14 días se activa en el panel. «Activar plan» abre el pago simulado «Pago de prueba» y no hay cobro. |
| `FLOW_API_URL` | Sandbox: `https://sandbox.flow.cl/api`. En real tiene que ser `https://www.flow.cl/api`. |
| `MERCADOPAGO_ACCESS_TOKEN` | Mismo pago de prueba que sin Flow. No se llama a `api.mercadopago.com`. |
| `MERCADOPAGO_WEBHOOK_SECRET` | `POST /api/mercadopago/webhook` responde 503 y no procesa avisos. |
| `MERCADOPAGO_PUBLIC_KEY` | No cambia el cobro. El servidor crea la suscripción con el access token. |
| `WHATSAPP_TOKEN` | El hilo queda en el panel y no sale al celular. |
| `WHATSAPP_APP_SECRET` | `POST /api/whatsapp` responde 503. |
| `WHATSAPP_VERIFY_TOKEN` | `GET /api/whatsapp` responde 503 y Meta no verifica el webhook. |
| `RESEND_API_KEY` | El correo se anota en Administración y no se envía. |
| `SENTRY_DSN` | No se reporta nada fuera del log. Con DSN, el servidor y el navegador (vía `/api/observabilidad`) envían el error a Sentry. |
| `SEED_DEMO` | En producción el seed se niega. No lo pongas en `1` en el servidor público. |
| `ADMIN_EMAILS` | Nadie ve el costo por empresa ni puede suspender. |

## Cabeceras

La CSP de producción no incluye `unsafe-eval`. Next 16 no lo usa fuera de `npm run dev` (ahí React arma el recuadro de errores). No lo agregues en Vercel para «hacer funcionar» el sitio: el build publicado ya corre sin eso. Los estilos en línea de Next siguen permitidos; no hace falta aflojar `script-src` más que `'self'` y `'unsafe-inline'`.

## Antes de abrir el cobro

- Un pago de sandbox llega a `/api/flow/confirmacion`, la firma inválida responde 401 y un token real deja el agente activo.
- Un aviso de Mercado Pago con firma inválida o `ts` vencido responde 401. Con firma válida, el estado se lee de la API (no del cuerpo) y deja el agente activo, cancelado o vencido.
- Un POST a `/api/whatsapp` sin `X-Hub-Signature-256` válida responde 401.
- El cupo del plan corta la llamada a xAI y el panel avisa desde el 80%.
- `GET /api/health` responde `{ "ok": true, "base": "ok" }`. El chequeo de uptime está en `docs/MONITOREO.md`.
- Las cuentas `maria@losaromos.cl` y `pedro@cafedelpuerto.cl` no están cargadas, o `SEED_DEMO` no está en `1`.

## Pendiente de verificar con Mercado Pago

Esto no está probado contra la API real. No lo des por cerrado antes del primer cobro.

- **Dónde se configura el webhook de suscripciones.** Al crear la preapproval enviamos `notification_url` hacia `/api/mercadopago/webhook`. Falta confirmar si para los tópicos `subscription_preapproval`, `subscription_authorized_payment` y `payment` basta esa URL, o si Mercado Pago igual exige registrarla en el panel (Tus integraciones → Webhooks).
- **`free_trial`.** No enviamos `auto_recurring.free_trial`. La prueba de 14 días sigue en nuestra base. Falta confirmar si el preapproval en Chile acepta ese campo y cómo se llevaría con el primer cobro.
