# Brazo Derecho

Beta multi-empresa para pymes en Chile. Tres agentes se activan por separado:

- **Atención WhatsApp**: responde con la base de conocimiento y deriva a una persona si no está. No cobra, no promete descuentos, no da asesoría legal ni médica y no manda publicidad masiva. Tope: 1.000 respuestas al mes.
- **Cotizador**: arma cotizaciones solo con la lista de precios y deja un PDF para aprobar. No inventa precios, no envía la cotización y no emite boleta. Tope: 300 cotizaciones al mes.
- **Marketing**: prepara textos e imágenes en borrador. No publica, no compra avisos y no responde comentarios. Tope: 60 textos y 30 imágenes al mes.

Los precios de referencia son $39.990, $49.990 y $34.990 netos al mes, más IVA. En la beta la prueba dura 14 días y no hay cobro.

La copia del producto está en español de Chile. El cliente de xAI es simulado: no llama a la red.

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

`SESSION_SECRET` tiene que tener al menos 32 caracteres. Cámbiala fuera de tu computador. `XAI_MODE` queda en `mock`. Cualquier otro valor está rechazado a propósito.

## Cuentas de demostración

El seed local crea dos empresas separadas. La contraseña de las dos es `Clave-demo-2026`.

| Correo | Empresa |
| --- | --- |
| maria@losaromos.cl | Ferretería Los Aromos |
| pedro@cafedelpuerto.cl | Café del Puerto |

Entran al panel con datos distintos. María no ve la carta del café y Pedro no ve la lista de la ferretería. No uses estas claves en un servidor público. El seed no corre en producción salvo que definas `SEED_DEMO=1`.

## Cómo está armado

- Next.js (App Router) y TypeScript.
- Prisma y Postgres. Cada fila de negocio lleva `organizationId`.
- Sesión propia: correo y contraseña, hash con bcrypt, JWT en una cookie `httpOnly`.
- Al entrar al panel se vuelve a comprobar que la persona pertenece a esa empresa.
- El límite de uso se descuenta en la misma transacción que guarda la respuesta, la cotización o los borradores. El mes se calcula en `America/Santiago`.
- El cotizador ignora cualquier precio que no esté en la lista de esa empresa. El estado de un post lo pone el servidor y siempre es borrador.

```
Sitio y panel
    |
    v
Acciones del servidor  -- filtran por empresa de la sesión
    |
    +--> Postgres
    +--> Reglas (conocimiento, lista, límites)
    +--> Cliente xAI simulado
```

El simulador de WhatsApp no está conectado a Meta. Marketing no publica. El PDF no se envía al cliente.

## Scripts

```bash
npm test                 # pruebas unitarias, sin base
npm run test:integration # aislamiento entre empresas; necesita Postgres
npm run typecheck
npm run lint
npm run build
```

## Qué falta para salir de la beta

- Confirmar por escrito con xAI el uso comercial y recién ahí cambiar el cliente simulado por la API.
- Conectar WhatsApp Cloud API de Meta, con aviso a la persona que escribe.
- Cobro con Flow y boleta electrónica.
- Revisión legal de términos, privacidad y el contrato de tratamiento (Ley 21.719) antes del primer cobro.

Los textos de `/terminos` y `/privacidad` son borradores de la beta, no un contrato.
