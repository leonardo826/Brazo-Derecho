# Driver del computador

El chat y el arriendo no eligen proveedor. Un escritorio especializado entra si cumple este contrato. Fly, u otro, queda detrás. No se reescribe el aislamiento ni la sesión.

## Lo que se reutiliza

- Una fila por empresa (`clientId`), con `machineId`, dirección fijada, época y token cifrado con AAD `v1` + empresa + máquina.
- Auditoría de operador: acción, resultado y época. Sin token y sin URL.
- `loadTenantLease` solo devuelve listo si la empresa es QA, no está suspendida, la fila está `RUNNING` y el DNS vuelve a contener la IP fijada. `127.0.0.1` no sale por esta función.
- Cada llamada usa esa IP fijada, no un nombre resuelto otra vez al conectar.
- Antes de llamar se vuelve a leer la época. Si cambió o la fila ya no está `RUNNING`, no se llama.

## Lo que el proveedor debe ofrecer

HTTPS alcanzable desde la app. Cada request va firmada con HMAC del token (método, ruta, cuerpo, timestamp, nonce y host). El cuerpo de `POST /task` incluye `agentKind`. El token no viaja. `POST /handshake` incluye el host en la prueba y el agente lo compara con `MACHINE_AGENT_DOMAIN`. `POST /task`, `POST /task/cancel` y `POST /action` exigen la época. `/action` solo corre si esa tarea sigue viva. Sin firma, 401. Con otra máquina, 403. Época distinta o vacía, 409. Un `agentKind` fuera de Contador, Marketing y WhatsApp, 400. El alta exige la prueba y `--attest-ownership`, y solo un dueño o un admin de plataforma puede registrar o cambiar el origen. La máquina es de la empresa: los tres agentes comparten ese computador y cada uno abre su propio perfil.

## Encendido

Un computador por empresa. `ComputerProvider` es `create`, `start`, `stop`, `delete`, `status` y `getEndpoint`. `StaticProvider` es el VPS que ya está: `start` y `stop` no lo apagan. El estado guardado es `OFF → STARTING → READY → STOPPING → OFF`, y `ERROR`. Un `UPDATE` condicionado impide dos arranques. La app no manda una tarea hasta un apretón firmado y el estado `READY` de esa máquina y esa época. Si se agota el tiempo, la persona ve «Encendiendo tu computador…». GitHub Actions llama `GET /api/cron/computer-idle` solo si la variable `COMPUTER_IDLE_ENABLED` vale exactamente `true`, con `CRON_SECRET`, y apaga las máquinas quietas más de 15 minutos (`COMPUTER_IDLE_MINUTES`) si `activeTaskCount` es 0. Sin la variable el cron se salta. Un disparo manual corre igual y falla si falta el secret. Antes pide `POST /browser/close`. Un contador colgado más de 30 minutos se suelta si el agente no tiene una tarea. Un apagado fallido queda en `ERROR` (`apagado`) y se puede volver a tomar. Los segundos encendidos quedan en `ComputerPowerUse`. No hay cron en `vercel.json`.

## Lo que este paso no es

No compra máquinas, no elige un SDK de nube y no trata un simulador como navegación. El servicio de referencia está en `machine-agent/` y se instala con `README-machine-agent.md`. La intención durable, la evidencia de tarifa y la Bóveda quedan aparte. `COMPUTER_FEATURE_ENABLED` sigue apagado salvo que valga exactamente `true`, y la empresa tiene que estar en `COMPUTER_ENABLED_ORGS`. Si esa lista falta o está vacía, no entra nadie.
