# Driver del computador

El chat y el arriendo no eligen proveedor. Un escritorio especializado entra si cumple este contrato. Fly, u otro, queda detrás. No se reescribe el aislamiento ni la sesión.

## Lo que se reutiliza

- Una fila por empresa (`clientId`), con `machineId`, dirección fijada, época y token cifrado con AAD `v1` + empresa + máquina.
- Auditoría de operador: acción, resultado y época. Sin token y sin URL.
- `loadTenantLease` solo devuelve listo si la empresa es QA, no está suspendida, la fila está `RUNNING` y el DNS vuelve a contener la IP fijada. `127.0.0.1` no sale por esta función.
- Cada llamada usa esa IP fijada, no un nombre resuelto otra vez al conectar.
- Antes de llamar se vuelve a leer la época. Si cambió o la fila ya no está `RUNNING`, no se llama.

## Lo que el proveedor debe ofrecer

HTTPS alcanzable desde la app. `POST /handshake` recibe `nonce` y `machineId` y responde la prueba HMAC, sin recibir el token. `GET /status` exige `Authorization: Bearer`. `POST /task` recibe `goal`, `machineId`, `taskId` y `epoch`. `POST /task/cancel` aborta esa tarea. `POST /action` solo si esa tarea sigue viva. Sin token, 401. Con otra máquina, 403. Una época distinta, 409. El id que responde status no prueba por sí solo que la máquina es de esa empresa: el alta exige la prueba HMAC y `--attest-ownership`, y solo un dueño o un admin de plataforma puede registrar o cambiar el origen.

## Lo que este paso no es

No compra máquinas, no elige proveedor y no trata un simulador como navegación. El servicio de referencia está en `machine-agent/` y se instala con `README-machine-agent.md`. La intención durable, la evidencia de tarifa y la Bóveda quedan aparte. `COMPUTER_FEATURE_ENABLED` sigue apagado salvo que valga exactamente `true`.
