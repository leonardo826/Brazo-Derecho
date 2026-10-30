# Seguridad

Para reportar un problema de seguridad, escribe en privado al dueño del repositorio. No abras un issue público con el detalle.

## Qué ya revisa el código

Estas piezas ya están y no hay que rehacerlas: cabeceras de seguridad (CSP, `X-Frame-Options`, HSTS solo en producción), límite de intentos en memoria, Sentry que no llama a la red si `SENTRY_DSN` está vacío, pruebas de aislamiento entre empresas y el seed de demostración.

La CSP sigue la guía de Next 16 sin nonces, para no obligar a render dinámico en la portada. `script-src` es `'self' 'unsafe-inline'`. `'unsafe-eval'` entra solo si `NODE_ENV` es `development`, porque el servidor de desarrollo de React lo usa para reconstruir el stack. `next start`, la CI y Vercel no lo envían. No hace falta `upgrade-insecure-requests`: el recorrido de Playwright usa `http://127.0.0.1`.

- **Flow.** El HMAC es el del manual: parámetros ordenados, nombre pegado al valor, SHA-256 con `FLOW_SECRET_KEY`, parámetro `s`. Una firma que no calza responde 401 y no toca la suscripción. El aviso que documenta Flow hoy trae solo `token`; en ese caso el estado se pide firmado a `payment/getStatus`. Un campo extra (monto, estado) sin firma válida se rechaza.
- **WhatsApp.** `POST /api/whatsapp` exige `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo con `WHATSAPP_APP_SECRET`). Si no calza, responde 401. Sin el secreto, responde 503.
- **Twilio.** No hay ruta Twilio. Si se agrega, hay que validar `X-Twilio-Signature` y rechazar antes de procesar.
- **Cupo.** Cada llamada a xAI pasa antes por el límite mensual del plan. Al llegar, el panel muestra un mensaje en español de Chile y no llama al modelo. Desde el 80% hay un aviso. Administración muestra el costo estimado por empresa y por mes.
- **CI.** Cada pull request corre typecheck, lint, unitarias, integración con Postgres y Playwright, en modo simulado y sin claves.

## Checklist para una persona, antes de producción

- [ ] `npm audit fix` (sin `--force`) se corrió el 30 de octubre de 2026 y no había arreglos compatibles. Quedan 9 avisos cuyo único fix es un salto mayor: `next` 16, `prisma` 7, `vitest` 5 y `zod` 4. No se aplicó `--force`. Hay que decidir esos saltos a mano.
- [ ] `SESSION_SECRET` de producción no es la del ejemplo y tiene al menos 32 caracteres.
- [ ] `ADMIN_EMAILS` son correos de personas reales. `SEED_DEMO` no está en `1`.
- [ ] Un POST de Flow con `s` inválido responde 401. Un pago de sandbox con solo `token` actualiza la suscripción después de `payment/getStatus`.
- [ ] Un POST de WhatsApp sin firma válida responde 401. El número quedó vinculado a una sola empresa.
- [ ] Confirmar con xAI el uso comercial de la API. Recién ahí sacar `XAI_MODE=mock`.
- [ ] Vercel Pro (el Hobby corta a los 10 segundos; xAI espera hasta 45), dominio, cuenta Flow y número de WhatsApp los hace el dueño. El detalle está en `docs/PASO-A-REAL.md`.
- [ ] El límite de intentos vive en la memoria del proceso: en varias instancias de Vercel no es un tope global.
- [ ] Si se llena `SENTRY_DSN`, revisar que el evento no lleve el texto del cliente ni el token de pago.
- [ ] Términos y privacidad siguen en borrador. Hace falta revisión legal (Ley 21.719) antes del primer cobro.
- [ ] `.env` no está en el repositorio.
