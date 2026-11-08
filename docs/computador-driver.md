# Driver del computador

El chat y el arriendo no eligen proveedor. Un escritorio especializado entra si cumple este contrato. Fly, u otro, queda detrás. No se reescribe el aislamiento ni la sesión.

## Lo que se reutiliza

- Una fila por empresa (`clientId`), con `machineId`, dirección fijada, época y token cifrado con AAD `v1` + empresa + máquina.
- Auditoría de operador: acción, resultado y época. Sin token y sin URL.
- `loadTenantLease` solo devuelve listo si la empresa es QA, no está suspendida, la fila está `RUNNING` y el DNS vuelve a contener la IP fijada. `127.0.0.1` no sale por esta función.
- Cada llamada usa esa IP fijada, no un nombre resuelto otra vez al conectar.
- Antes de llamar se vuelve a leer la época. Si cambió o la fila ya no está `RUNNING`, no se llama.

## Lo que el proveedor debe ofrecer

HTTPS alcanzable desde la app. `GET /status` con `Authorization: Bearer` responde `ok: true` y el mismo `machineId`. `POST /task` recibe solo `goal` y `machineId`. `POST /task/cancel` aborta esa máquina. Sin token, 401. Con otra máquina, 403. El id que responde status no prueba por sí solo que la máquina es de esa empresa: el operador lo atestigua con `--attest-ownership`.

## Lo que este paso no es

No compra máquinas, no elige proveedor y no trata un simulador como navegación. La autorización por acción, el cancel si solo vence el tiempo, la intención durable, la evidencia de tarifa y la Bóveda quedan aparte.
