# Cómo probar la demo

Todo corre en tu computador. Sin claves no hay llamadas a xAI, no sale un correo, no se cobra en Flow y no se manda ningún WhatsApp.

## Levantar

Necesitas Node.js 22 y Postgres 16.

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Abre http://localhost:3000. En `.env` deja `XAI_MODE=mock` y las claves vacías.

## Cuentas

La contraseña de las dos es `Clave-demo-2026`. El correo ya está confirmado.

| Correo | Empresa |
| --- | --- |
| maria@losaromos.cl | Ferretería Los Aromos |
| pedro@cafedelpuerto.cl | Café del Puerto |

Entra en Ingresar. María tiene horarios, despacho y un descuento que el agente rechaza, más dos cotizaciones. Pedro tiene el horario y la carta del café, una cotización y un borrador. Cada uno ve solo lo suyo.

## Recorrido «Prueba la demo»

La primera vez que abres el panel, arriba del contenido, sale un aviso de cinco pasos. Te lleva al inicio, a Atención WhatsApp, al Cotizador y a Marketing. «Siguiente» cambia de pantalla. «Atrás» vuelve. «Ahora no», «Cerrar», «Listo» o la tecla Escape lo guardan como visto: no vuelve a salir solo en ese navegador. En el menú queda el botón «Prueba la demo» para abrirlo otra vez.

En el celular el aviso ocupa el ancho de la pantalla y se puede cerrar sin tapar los botones del formulario.

## Qué mirar

1. Sin entrar: Agentes y Precios. Ahí está qué hace cada uno, qué no hace, el neto y el IVA.
2. Con María: Atención WhatsApp, Cotizador, Marketing y Uso del mes. El texto lo arma el simulador. La cotización queda pendiente: no se envía. El borrador no se publica.
3. Sal y entra con Pedro. No debe aparecer la pintura ni el taladro de la ferretería.
4. En `.env` pon `ADMIN_EMAILS=maria@losaromos.cl`, reinicia `npm run dev` y entra con María. En Administración ves el costo estimado del mes por empresa y, si el correo está simulado, el texto del mensaje.

El seed se puede correr otra vez: no duplica fichas ni hilos. No uses `Clave-demo-2026` en un servidor público.
