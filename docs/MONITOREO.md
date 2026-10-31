# Monitoreo

La beta no contrata un servicio de uptime ni manda avisos sola. Esta nota dice cómo mirar si el sitio sigue en pie, con herramientas gratis que configura el dueño.

## Qué revisar

`GET /api/health` pregunta a Postgres con `SELECT 1` y espera como máximo dos segundos.

| Respuesta | Significado |
| --- | --- |
| `200` y `{ "ok": true, "servicio": "brazo-derecho", "base": "ok" }` | La app y la base contestan. |
| `503` y `{ "ok": false, "base": "error" }` | El proceso respondió, pero la base no. |
| Sin respuesta, o un 5xx de la plataforma | El sitio no está sirviendo. |

La URL pública queda `https://TU-DOMINIO/api/health`. No usa claves. No conviene pegarle desde el navegador de un cliente: es para un chequeo automático.

## Opciones gratis

Elige una. No hace falta pagar ni dejar una clave en este repositorio.

1. **UptimeRobot, plan gratis.** Un monitor HTTP(s) cada 5 minutos contra `/api/health`. Marca la alerta cuando el código no es 200. El aviso llega al correo del dueño. El plan gratis alcanza para un solo sitio.
2. **Freshping, plan gratis.** Igual: un chequeo HTTP a la misma URL y un correo si deja de responder 200.
3. **cron-job.org.** Un trabajo programado que hace GET a `/api/health` y avisa por correo si falla. El servicio es gratis.
4. **Uptime Kuma en un computador que ya tengas.** Es software libre. El monitor HTTP apunta a `/api/health` y el aviso sale por el canal que configures ahí (correo propio, no un SaaS de pago de Brazo Derecho).

En las cuatro, el chequeo esperado es un `200`. Un `503` también es una falla: la base no contestó. No pongas la URL de un webhook ni una clave en el monitor.

## Errores con Sentry

`SENTRY_DSN` vacío: no sale nada de la máquina. El error queda en el log del proceso.

Con un DSN:

- El servidor reporta las excepciones de los webhooks de Flow y WhatsApp.
- El navegador, si una pantalla del panel falla, avisa a `POST /api/observabilidad`. Ese endpoint reenvía a Sentry solo si el DSN está puesto. El navegador no habla directo con Sentry y el DSN no va en el JavaScript público.

El evento lleva el nombre y un mensaje corto. No manda el texto del cliente, el token de pago ni la tarjeta. La tarjeta, en el pago de prueba, ni siquiera se pide.
