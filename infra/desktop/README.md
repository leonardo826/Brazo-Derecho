# Computador del agente (Fase 0 local)

Un escritorio por cliente: Debian, Xvfb, fluxbox, Chromium, noVNC y el agente en `agent-runtime/`. El perfil del navegador queda en `/data/chrome-profile` (volumen). WhatsApp Web se abre en otra pestaña del **mismo** Chromium. El QR lo escanea una persona. No hay envíos masivos ni pagos.

No crea apps en Fly y no gasta plata. El computador de producción parte recién cuando Leonardo cargue las claves.

## Probar en local, sin claves

Hace falta Docker. Desde la raíz del repo:

```bash
docker compose -f infra/desktop/docker-compose.yml up --build
```

Eso no usa el `docker compose` de Postgres. Cuando el healthcheck responda:

1. Abre noVNC en el navegador: http://127.0.0.1:6080/vnc.html
2. Pulsa Connect. En local no pide clave: el puerto está atado a `127.0.0.1`.
3. Vas a ver Chromium. Otra pestaña (o la lista de pestañas) es https://web.whatsapp.com/. El QR se escanea a mano. Si reinicias el contenedor, el perfil sigue en el volumen `chrome_profile` y WhatsApp no debería pedir el QR otra vez.
4. Estado del agente: http://127.0.0.1:8787/status  
   Con `XAI_MODE=mock` (el default) o sin `XAI_API_KEY`, `xaiMode` es `mock`.

Tarea de ejemplo, sin API de pago:

```bash
curl -sS http://127.0.0.1:8787/status
bash infra/desktop/sample-task.sh "Abre https://example.com y dime el título"
bash infra/desktop/sample-task.sh "Busca Chile en Wikipedia"
curl -sS http://127.0.0.1:8787/screenshot -o /tmp/pantalla.png
```

El simulador abre la URL y devuelve el texto. No llama a xAI. Para mirar la página, usa noVNC o el PNG.

Playwright (el mismo Chromium, por CDP):

```bash
docker compose -f infra/desktop/docker-compose.yml exec desktop node playwright-cdp.mjs
```

Logs si la pantalla sale en negro: dentro del contenedor, `/tmp/chromium.log`, `/tmp/xvfb.log` y `/tmp/novnc.log`.

Para bajarlo: `docker compose -f infra/desktop/docker-compose.yml down`. El volumen del perfil se conserva. `down -v` lo borra.

## Variables

| Variable | Para qué | Si falta |
| --- | --- | --- |
| `XAI_MODE` | `mock` obliga al simulador. `live` llama a xAI solo si hay clave. | Sin clave queda en `mock`. |
| `XAI_API_KEY` | Clave de la Responses API. Solo por entorno, nunca en el repo. | Simulador, sin red. |
| `XAI_API_URL` | Base de la API. | `https://api.x.ai/v1` |
| `XAI_COMPUTER_MODEL` | `grok-4.3` (default) o `grok-4.7`. | `grok-4.3` |
| `AGENT_RUNTIME_TOKEN` | Si tiene valor, `/task` y el resto exigen `Authorization: Bearer`. Tiene que ser el mismo valor que `COMPUTER_AGENT_TOKEN` de la app. | La API escucha sin clave. En compose el puerto del host es `127.0.0.1`. |
| `VAULT_FILL_URL` | URL de `POST /api/credenciales/rellenar` para escribir un acceso en el formulario. La clave no va al modelo. | El relleno falla y no se inventa una clave. La llave maestra no vive en este computador: está en `CREDENTIALS_MASTER_KEY` de la app. |
| `COMPUTER_AGENT_URL` | La app Next le manda la tarea a `POST /task`. En local: `http://127.0.0.1:8787`. | La tarea queda en cola y no hay red. |
| `COMPUTER_PANEL` | `true` muestra «Ver mi computador» en producción. | En `next dev` se muestra. En producción no. |
| `FLY_API_TOKEN` | Token de Fly. Solo por entorno. | El alta no llama a Fly. |
| `FLY_DRY_RUN` | Exactamente `false` para permitir la API. | Dry-run. |

`XAI_API_KEY` y `FLY_API_TOKEN` no van en archivos commiteados. El compose las lee del entorno si existen y, si no, deja la clave vacía.

## Pruebas sin Docker y sin claves

```bash
npm test
```

El test del simulador hace `goto` a example.com y toma una captura falsa. No abre Chromium ni llama a xAI ni a Fly.

## Fase 1 (plantilla, sin gasto)

`infra/desktop/fly.toml` es una plantilla: no tiene servicio HTTP público y el nombre de app es `iabot-desktop-PLANTILLA`. No corras `fly apps create` ni `fly deploy`.

El plan de una máquina + volumen:

```bash
npx tsx scripts/provision-client.ts --client <organizationId>
```

Imprime el plan y termina. **No llama a Fly** aunque `FLY_API_TOKEN` esté en el entorno, salvo que además `FLY_DRY_RUN` sea exactamente `false` y pases `--confirmo-gasto`. Eso lo decide Leonardo cuando cargue las claves. Hasta entonces no hay computador de producción ni cobro.

La app Next guarda `Computer` (un cliente = una fila) y una cola de tareas. «Ver mi computador» entrega un token de 10 minutos (se guarda el hash, no el token). Enviar mensaje o pagar queda pendiente de aprobación y, aunque se apruebe, **no se ejecuta** en esta fase.

## Qué queda para mañana

1. Leonardo aprueba el gasto y carga `XAI_API_KEY` y `FLY_API_TOKEN` en el entorno (Vercel/Fly), no en el repo.
2. Recién ahí se puede construir la imagen, subirla y correr el script con `FLY_DRY_RUN=false` y `--confirmo-gasto`.
3. Escanear el QR de un número de prueba desde noVNC. No usar números de clientes y no automatizar envíos.
