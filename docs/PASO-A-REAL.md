# Paso a real

La beta sigue en simulador mientras falte una clave. Este es el checklist para cobrar y responder de verdad. Lo que dice «dueño» no lo puede hacer el código: es una cuenta, un número o un pago a nombre de la persona.

## Lo que tiene que hacer el dueño

1. **Clave de xAI.** Crear la clave en la consola de xAI y pegarla en `XAI_API_KEY`. Sacar `XAI_MODE=mock` (déjalo vacío). Sin eso el panel sigue en el simulador y no gasta API.
2. **Cuenta de Flow.** Registrarse en [sandbox.flow.cl](https://sandbox.flow.cl) para probar y en [www.flow.cl](https://www.flow.cl) para cobrar. En Mis datos → Integraciones copiar API Key y Secret Key. El aviso de pago del plan tiene que apuntar a `https://TU-DOMINIO/api/flow/confirmacion`. Probar un pago de sandbox antes de pasar a producción.
3. **Cuenta de Mercado Pago.** Crear una aplicación en el panel de desarrolladores. Para probar, usar credenciales de prueba (`MERCADOPAGO_ACCESS_TOKEN` empieza con `TEST-`). Para cobrar, las de producción. El secreto del webhook va en `MERCADOPAGO_WEBHOOK_SECRET`. Al crear la suscripción enviamos `notification_url` = `https://TU-DOMINIO/api/mercadopago/webhook`. `MERCADOPAGO_PUBLIC_KEY` es opcional y el servidor no la usa. En la prueba, `MERCADOPAGO_TEST_PAYER_EMAIL` puede ser el correo de un comprador de prueba: solo se manda como `payer_email` si el access token empieza con `TEST-`. En producción se ignora. Sin access token, Mercado Pago usa el mismo pago de prueba que Flow y no llama a la API. Si la API rechaza la llamada, el log anota el código HTTP y los campos `message` y `cause`, sin el token ni las cabeceras.
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
MERCADOPAGO_TEST_PAYER_EMAIL=""

WHATSAPP_TOKEN="token-de-meta"
WHATSAPP_PHONE_NUMBER_ID="id-de-referencia"
WHATSAPP_VERIFY_TOKEN="un-token-que-tu-inventas-y-pegas-en-meta"
WHATSAPP_APP_SECRET="app-secret-de-meta"

ADMIN_EMAILS="dueno@tu-dominio"
DEMO_SEED=""
SENTRY_DSN=""
RESEND_API_KEY="re_..."
RESEND_FROM="Brazo Derecho <hola@TU-DOMINIO>"

# Precio bruto mensual, IVA incluido. La portada y Mercado Pago usan este monto.
# En producción tiene que ser 63546. Si se deja el neto antiguo 53400, el código igual cobra 63546.
IABOT_PRICE_CLP="63546"
USAGE_USD_PER_M_INPUT=""
USAGE_USD_PER_M_CACHED=""
USAGE_USD_PER_M_OUTPUT=""
USAGE_FX_CLP_PER_USD=""
USAGE_COMPUTER_USD=""
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
| `MERCADOPAGO_TEST_PAYER_EMAIL` | `payer_email` es el correo de la sesión. Con un token que no empieza con `TEST-` la variable no se usa. |
| `WHATSAPP_TOKEN` | El hilo queda en el panel y no sale al celular. |
| `WHATSAPP_APP_SECRET` | `POST /api/whatsapp` responde 503. |
| `WHATSAPP_VERIFY_TOKEN` | `GET /api/whatsapp` responde 503 y Meta no verifica el webhook. |
| `RESEND_API_KEY` | El correo se anota en Administración y no se envía. |
| `SENTRY_DSN` | No se reporta nada fuera del log. Con DSN, el servidor y el navegador (vía `/api/observabilidad`) envían el error a Sentry. |
| `DEMO_SEED` | En producción el seed no crea ni actualiza las cuentas demo. Solo el valor exacto `true` las carga. `SEED_DEMO=1` ya no alcanza. No lo pongas en el servidor público. |
| `ADMIN_EMAILS` | Nadie ve el costo por empresa ni puede suspender. |
| `IABOT_PRICE_CLP` | Vacío usa el bruto del código, 63546. La portada dice «$63.546 al mes, IVA incluido» y Mercado Pago cobra ese monto. Si en producción sigue el neto 53400, el código también usa 63546. Un texto inválido deja la portada en «Precio de lanzamiento: pronto» y el cobro sigue en 63546. |
| `USAGE_USD_PER_M_INPUT`, `USAGE_USD_PER_M_CACHED`, `USAGE_USD_PER_M_OUTPUT` | El estimado usa las constantes de grok-4.3 y grok-4.7. No es una tarifa en vivo. |
| `USAGE_FX_CLP_PER_USD` | El estimado usa 900 pesos por dólar. No es el tipo de cambio del día. |
| `USAGE_COMPUTER_USD` | El computador en la nube suma US$0 al estimado. |

## Cabeceras

La CSP de producción no incluye `unsafe-eval`. Next 16 no lo usa fuera de `npm run dev` (ahí React arma el recuadro de errores). No lo agregues en Vercel para «hacer funcionar» el sitio: el build publicado ya corre sin eso. Los estilos en línea de Next siguen permitidos; no hace falta aflojar `script-src` más que `'self'` y `'unsafe-inline'`.

## Antes de abrir el cobro

Lo que se puede mirar desde afuera, sin secretos y sin escribir en la base, lo corre el chequeo de la sección siguiente. Lo que exige una cuenta, un pago de sandbox o una persona sigue en esta lista.

- Un pago de sandbox llega a `/api/flow/confirmacion`, la firma inválida responde 401 y un token real deja el agente activo. Si hoy solo cobras con Mercado Pago y Flow no tiene claves, el chequeo lo deja en advertencia.
- Un aviso de Mercado Pago con firma inválida o `ts` vencido responde 401. Con firma válida, el estado se lee de la API (no del cuerpo) y deja el agente activo, cancelado o vencido.
- Un POST a `/api/whatsapp` sin `X-Hub-Signature-256` válida responde 401.
- El cupo del plan corta la llamada a xAI y el panel avisa desde el 80%.
- `GET /api/health` responde `{ "ok": true, "base": "ok" }`. El chequeo de uptime está en `docs/MONITOREO.md`.
- Las cuentas `maria@losaromos.cl` y `pedro@cafedelpuerto.cl` no se crean en producción salvo `DEMO_SEED=true`. Si ya están y todavía entran con la clave del seed, el chequeo lo deja en advertencia. `npm run desactivar:demo` las bloquea sin borrar datos.

## Cuentas de demostración

El seed crea `maria@losaromos.cl` y `pedro@cafedelpuerto.cl` con la clave que imprime al terminar. En local (`NODE_ENV` distinto de `production`) se cargan como siempre.

En producción el seed no las crea ni las actualiza, salvo que `DEMO_SEED` sea exactamente `true`. `SEED_DEMO=1` ya no alcanza. No definas `DEMO_SEED` en Vercel.

Si esas cuentas ya están en la base pública, bloquéalas sin borrar datos:

```bash
npm run desactivar:demo
```

El script usa `DATABASE_URL`. Para cada una de esas dos cuentas:

- Pone `suspendedAt` en la empresa si todavía no estaba suspendida. Los agentes quedan detenidos. Hilos, cotizaciones, lista, uso y la ficha siguen en la base.
- Si la contraseña sigue siendo la del seed, la reemplaza por una clave aleatoria que no se imprime y sube `authVersion`, así las sesiones abiertas dejan de servir.
- Si la contraseña ya no es la del seed, no la cambia. Igual cierra las sesiones cuando suspende la empresa.
- No ejecuta ningún borrado.

Correrlo otra vez no escribe si la empresa ya está suspendida y la clave ya no es la del seed. Si la cuenta no existe, lo anota y sigue. Sin `DATABASE_URL` termina con código 1 y no abre la base.

Para dejarlas otra vez utilizables hay que correr el seed con `DEMO_SEED=true`. Eso devuelve la clave del seed y levanta la suspensión. No lo hagas en el servidor público.

## Chequeo de solo lectura

```bash
npm run verificar:produccion -- --url https://TU-DOMINIO
```

Si omites `--url`, usa `APP_URL` (del entorno o, si no está, la línea `APP_URL` de `.env`). No lee el resto de las claves. `--ayuda` muestra el uso.

El comando no crea cobros, suscripciones ni usuarios, no llama a xAI y no escribe en la base. Los avisos de prueba llevan una firma inválida o un cuerpo vacío, para que el servidor los rechace antes de consultar a Flow, a Mercado Pago o a la base. En Flow siempre va el parámetro `s`: un POST con solo `token` sí se acepta y consultaría el estado.

La salida es en español de Chile. Cada ítem queda en `PASA`, `FALLA` o `ADVERTENCIA`. El código de salida es 1 si hay una falla crítica y 0 si solo hay advertencias. Una URL que no sirve termina con código 2.

| Ítem | Qué se espera |
| --- | --- |
| Salud | `GET /api/health` responde 200 con `ok` verdadero y `base` en `ok`. |
| Mercado Pago | `POST /api/mercadopago/webhook` sin firma y con `ts` vencido responde 401. El cuerpo no trae un tópico de pago. |
| Flow | `POST /api/flow/confirmacion` con `s` inválido responde 401 si Flow está configurado. Un 503 con «Flow no está configurado» es advertencia, no falla crítica: hoy el cobro es con Mercado Pago. Otro código sigue siendo falla. |
| WhatsApp | `POST /api/whatsapp` sin `X-Hub-Signature-256` válida responde 401 o 503, y el informe dice cuál. |
| Verificación de Meta | `GET /api/whatsapp` con un verify token inventado responde 403. Un 503 queda como advertencia. Un 200 es falla. |
| Cabeceras | CSP sin `unsafe-eval`, HSTS, `X-Frame-Options: DENY`, `nosniff` y sin `X-Powered-By`. |
| Cookie | `bd_csrf` sale `HttpOnly`, `Secure` y `SameSite`. |
| Panel | `/panel` sin sesión redirige a `/ingresar`. |
| Textos legales | Si términos o privacidad siguen en borrador, es advertencia. La revisión legal (Ley 21.719) sigue siendo de una persona. |
| Observabilidad | Un cuerpo inválido en `POST /api/observabilidad` responde 400. No se envía un error de verdad, para no gastar Sentry. |
| Cuentas demo | `maria@losaromos.cl` y `pedro@cafedelpuerto.cl` con la clave del seed. Si entran, es advertencia. La cookie de sesión se descarta y no se usa. Para bloquearlas sin borrar datos, `npm run desactivar:demo`. |

Contra un `http://localhost` van a fallar HSTS y la cookie `Secure`: esas cabeceras son las de producción. Las pruebas de la evaluación están en `tests/unit/verificar-produccion.test.ts` y corren con `npm test`, sin red.

## Pendiente de verificar con Mercado Pago

Esto no está probado contra la API real. No lo des por cerrado antes del primer cobro.

- **Dónde se configura el webhook de suscripciones.** Al crear la preapproval enviamos `notification_url` hacia `/api/mercadopago/webhook`. Falta confirmar si para los tópicos `subscription_preapproval`, `subscription_authorized_payment` y `payment` basta esa URL, o si Mercado Pago igual exige registrarla en el panel (Tus integraciones → Webhooks).
- **`free_trial`.** No enviamos `auto_recurring.free_trial`. La prueba de 14 días sigue en nuestra base. Falta confirmar si el preapproval en Chile acepta ese campo y cómo se llevaría con el primer cobro.
