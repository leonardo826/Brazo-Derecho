# Brazo Derecho

Beta multi-empresa para pymes en Chile. Tres agentes se activan por separado:

- **Atención WhatsApp**: responde con la base de conocimiento y deriva a una persona si no está. No cobra, no promete descuentos, no da asesoría legal ni médica y no manda publicidad masiva. Tope: 1.000 respuestas al mes. Modelo habitual: `grok-4.3`.
- **Cotizador**: arma cotizaciones solo con la lista de precios y deja un PDF para aprobar. No inventa precios, no envía la cotización y no emite boleta. Tope: 300 cotizaciones al mes. Modelo complejo: `grok-4.7`.
- **Marketing**: prepara textos e imágenes en borrador. No publica, no compra avisos y no responde comentarios. Tope: 60 textos y 30 imágenes al mes. Modelo complejo: `grok-4.7`.

Los precios son $39.990, $49.990 y $34.990 netos al mes, más IVA de 19% (el cobro en Flow queda en $47.588, $59.488 y $41.638). La prueba dura 14 días.

Sin claves el panel sigue funcionando: xAI responde con el simulador, la prueba no se cobra y WhatsApp se prueba dentro del panel. La copia del producto está en español de Chile.

## Requisitos

- Node.js 22
- PostgreSQL 16

Con Docker:

```bash
docker compose up -d
```

Sin Docker, crea la base y el usuario `brazo` / `brazo` sobre la base `brazo_derecho`.

## Puesta en marcha

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Abre http://localhost:3000.

`SESSION_SECRET` tiene que tener al menos 32 caracteres. Cámbiala fuera de tu computador. Con `XAI_MODE=mock`, o sin `XAI_API_KEY`, no hay llamadas a xAI.

## Variables de entorno

Todas están en `.env.example`. Si falta la clave de un servicio, esa parte queda en el simulador.

| Variable | Para qué sirve | Si falta |
| --- | --- | --- |
| `DATABASE_URL` | Postgres de la app. En Neon puede ser la URL con pooler. | La app no parte. |
| `DIRECT_URL` | Conexión directa para `prisma migrate`. En local puede ser la misma que `DATABASE_URL`. En Neon usa la URL sin pooler. | La migración no corre. |
| `SESSION_SECRET` | Firma la cookie de sesión. Mínimo 32 caracteres. | La sesión no se puede crear. |
| `APP_URL` | URL pública, sin barra final. Flow avisa los pagos a `{APP_URL}/api/flow/confirmacion`. | Se usa `http://localhost:3000`. |
| `XAI_API_KEY` | Clave de la Responses API de xAI (`https://api.x.ai/v1/responses`). | El texto lo arma el simulador, sin red. |
| `XAI_API_URL` | Base de la API. | `https://api.x.ai/v1`. |
| `XAI_MODE` | `mock` obliga al simulador aunque exista clave. | Con clave, llama a xAI. |
| `XAI_MODEL_ROUTINE` | Modelo de tareas habituales. `grok-4.3` o `grok-4.7`. | `grok-4.3`. |
| `XAI_MODEL_COMPLEX` | Modelo de cotizaciones y marketing. `grok-4.3` o `grok-4.7`. | `grok-4.7`. |
| `FLOW_API_KEY` | Api key de Flow. | La prueba de 14 días se activa en el panel y no hay cobro. |
| `FLOW_SECRET_KEY` | Secreto para firmar cada llamada (HMAC-SHA256). | Igual que sin api key: no hay cobro. |
| `FLOW_API_URL` | Base del API. | `https://sandbox.flow.cl/api`. |
| `WHATSAPP_TOKEN` | Token de la app de Meta para enviar respuestas. | El hilo se guarda en el panel y no sale al teléfono. |
| `WHATSAPP_PHONE_NUMBER_ID` | Id de referencia del número. Igual hay que vincularlo a una empresa. | No se muestra la referencia. El enrutado usa el id guardado en la empresa. |
| `WHATSAPP_VERIFY_TOKEN` | Token que Meta envía al verificar el webhook. | `GET /api/whatsapp` responde 503. |
| `WHATSAPP_APP_SECRET` | Secreto de la app para revisar `X-Hub-Signature-256`. | `POST /api/whatsapp` responde 503 y no procesa mensajes. |
| `ADMIN_EMAILS` | Correos, separados por coma, que entran a Administración y vinculan el número de cualquier empresa. | Esa pantalla no aparece. El dueño igual vincula el número de su empresa en Atención WhatsApp. |
| `SEED_DEMO` | En producción, `1` permite correr el seed de demostración. | El seed se niega si `NODE_ENV=production`. |

Los tokens de cada respuesta quedan en `UsageEvent`, por empresa, con el modelo usado. El tope mensual se descuenta en la misma transacción que guarda la respuesta. El mes se calcula en `America/Santiago`.

## Cuentas de demostración

El seed local crea dos empresas separadas. La contraseña de las dos es `Clave-demo-2026`.

| Correo | Empresa |
| --- | --- |
| maria@losaromos.cl | Ferretería Los Aromos |
| pedro@cafedelpuerto.cl | Café del Puerto |

Entran al panel con datos distintos. María no ve la carta del café y Pedro no ve la lista de la ferretería. No uses estas claves en un servidor público.

## Cómo está armado

- Next.js (App Router) y TypeScript.
- Prisma y Postgres. Cada fila de negocio lleva `organizationId`.
- Sesión propia: correo y contraseña, hash con bcrypt, JWT en una cookie `httpOnly`. Al registrarse hay que aceptar términos y aviso de privacidad; se guarda la fecha. Las novedades comerciales son opcionales.
- Al entrar al panel se vuelve a comprobar que la persona pertenece a esa empresa.
- xAI: `POST /v1/responses`. Sin clave, el simulador redacta a partir de la ficha, la lista o el perfil. Un rechazo de atención (descuento, cobro, asesoría, publicidad masiva) no llama al modelo.
- Flow: planes mensuales `brazo-whatsapp`, `brazo-cotizador` y `brazo-marketing`, con 14 días de prueba la primera vez. El webhook `POST /api/flow/confirmacion` recibe el `token`, consulta el estado firmado y deja el agente activo o lo detiene.
- WhatsApp: `GET/POST /api/whatsapp`. El mensaje se enruta por `phone_number_id` a la empresa vinculada. Salud: `GET /api/health`.

```
Sitio y panel
    |
    v
Acciones del servidor  -- filtran por empresa de la sesión
    |
    +--> Postgres
    +--> Reglas (conocimiento, lista, límites)
    +--> xAI si hay XAI_API_KEY; si no, simulador
    +--> Flow si hay claves; si no, prueba local
    +--> WhatsApp Cloud API si hay token y número vinculado
```

## Despliegue en Vercel y Postgres

1. Crea una base en Neon (u otro Postgres administrado). Copia la URL con pooler a `DATABASE_URL` y la URL directa a `DIRECT_URL`. Si el proveedor no usa pooler, pon la misma URL en las dos.
2. En Vercel, importa el repositorio y define todas las variables de `.env.example`. `SESSION_SECRET` de al menos 32 caracteres. `APP_URL` con la URL pública (`https://tu-dominio.cl`), sin barra final.
3. El build (`vercel.json` y `npm run build`) corre `prisma generate`, después `prisma migrate deploy` y al final `next build`. Las migraciones tienen que poder conectar durante el build.
4. En Meta, la URL de devolución es `https://tu-dominio.cl/api/whatsapp`. El token de verificación es `WHATSAPP_VERIFY_TOKEN`.
5. En Flow (sandbox o producción), las claves van en `FLOW_API_KEY` y `FLOW_SECRET_KEY`. El plan avisa los pagos a `https://tu-dominio.cl/api/flow/confirmacion`.
6. Revisa `GET /api/health`. Responde `{ "ok": true }` cuando la base contesta.
7. En Administración (correos de `ADMIN_EMAILS`) vincula cada empresa con su id de número. Sin ese vínculo el webhook no sabe a qué agente entregar el mensaje.
8. Sin `XAI_API_KEY`, `FLOW_API_KEY` o `WHATSAPP_TOKEN` el panel sigue en modo simulado.

## Scripts

```bash
npm test                 # pruebas unitarias, sin base
npm run test:integration # aislamiento entre empresas; necesita Postgres
npm run typecheck
npm run lint
npm run build            # migra y construye; necesita DATABASE_URL y DIRECT_URL
```

## Qué falta para el primer cobro en serio

- Revisión legal de términos, privacidad y el contrato de tratamiento (Ley 21.719). El aviso en `/privacidad` es un borrador: los campos entre corchetes siguen marcados.
- Boleta o factura electrónica.
- Confirmar con xAI el uso comercial de la API antes de salir del sandbox.

Los textos de `/terminos` y `/privacidad` son borradores, no un contrato.
