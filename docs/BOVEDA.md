# Bóveda de claves

Cada empresa guarda accesos (SII, bancos, portales) cifrados. La pantalla está en `/panel/boveda`. La lista muestra nombre, portal, pista del usuario y fecha. No muestra la clave.

## Llave maestra

Hay que definir `CREDENTIALS_MASTER_KEY` en Vercel, en Production, como Secret. No va en el repositorio ni en el chat. Sin ella, guardar y leer la bóveda responden error y no escriben nada.

Generarla en tu computador:

```bash
openssl rand -base64 32
```

Eso imprime 32 bytes en base64. Pégalo solo en Vercel. Si rotas la variable, las claves ya guardadas dejan de poder leerse.

La app cifra con AES-256-GCM. La llave no se escribe en logs, no sale en las respuestas del panel y no entra en los prompts de xAI.

## Qué ve el modelo

El asistente del computador solo recibe metadatos: `id`, `label`, `portal`, `usernameHint`. La clave no va como texto al modelo ni a los prompts de xAI. Se descifra en el servidor y, si el cliente pidió ese ingreso, el agente del escritorio la escribe en el formulario. Esa llamada es `POST /api/credenciales/rellenar`.

Si el sitio muestra la clave en pantalla, la captura siguiente podría incluirla. Los campos de clave suelen ir enmascarados.

Esa ruta no usa la cookie de sesión. Exige `Authorization: Bearer` con `COMPUTER_AGENT_TOKEN`. El token viaja una sola vez, dura 2 minutos y no se puede repetir. La respuesta lleva el usuario y la clave para ese relleno y no vuelve al chat ni al modelo. En el computador, `AGENT_RUNTIME_TOKEN` tiene que ser el mismo valor y `VAULT_FILL_URL` apunta a `https://tu-dominio/api/credenciales/rellenar`.

Si `COMPUTER_AGENT_TOKEN` está vacío, la ruta responde 503 y no descifra.

## Declarar y pagar

Presentar una declaración o pagar queda pendiente aunque la clave exista. En la bóveda hay que confirmarlo aparte. La confirmación dura 15 minutos, queda en el registro y se gasta al usar la clave para esa acción.

En esta fase el computador no presenta la declaración ni paga, ni después de confirmar. Confirmar no manda plata ni manda el trámite.

## APIs

Con la sesión de la empresa:

- `GET /api/credenciales` lista sin secretos.
- `POST /api/credenciales` exige `consentAcceptedAt: true` y cifra antes de guardar.
- `DELETE /api/credenciales/:id` borra el acceso. El registro conserva el id y el nombre.
- `GET /api/credenciales/auditoria` muestra los usos y las bajas, sin secretos.
- `POST /api/credenciales/confirmar` con `{ "action": "DECLARAR" | "PAGAR", "confirmed": true }`.
