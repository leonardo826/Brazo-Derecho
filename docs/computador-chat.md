# Computador desde el chat

La especialidad contable orienta. No impide una tarea pública que el computador de esa empresa pueda ejecutar. Si falta un dato indispensable, se pregunta solo eso y el turno siguiente sigue la misma intención, aislada por persona, empresa e hilo. Comprar, pagar, declarar, enviar o un cambio irreversible pide confirmación. Entrar a un sitio no autoriza esas acciones.

## Arriendo que sí se puede habilitar

`POST /api/computer/lease`, con la sesión de la empresa, guarda `machineId`, el origen del worker y el token cifrado con `CREDENTIALS_MASTER_KEY`. La respuesta no devuelve el token. `loadTenantLease` lee esa fila y solo entonces llama. Sin fila, sin clave maestra o con un origen interno, no llama.

El origen tiene que ser `https://` alcanzable desde la app, o `http://127.0.0.1` en local. `*.internal` no se acepta: es la red privada de Fly y esta app no está en ella. El script de provisión sigue solo imprimiendo el plan. `XAI_MODE=mock` no es un resultado.

## Qué sigue abierto

La intención pendiente vive en memoria de un proceso. En serverless no dura entre instancias. Un `goto` público no prueba una tarifa. El redirect manual no cubre un click o una tecla que salga del sitio. El tiempo agotado no llama a `/task/cancel` si el abort no llegó a dispararse. El escritorio aún no autoriza cada acción ni mide el consumo por paso. La Bóveda no se inyecta desde el chat. Nada de eso se presenta como capacidad real.

Un resultado solo se acepta si el runtime responde `DONE`, `xaiMode: live`, y un paso `goto` a una URL pública cuyo nombre aparece en el texto. Una captura inicial no alcanza. El simulador no cuenta.

El relleno de la Bóveda no sale del chat. Una cookie que ya viva en el navegador de una máquina no demuestra que el secreto quedó aislado. El chat no envía claves.

## Runtime local

`agent-runtime` rechaza la petición si falta `AGENT_RUNTIME_TOKEN` o si `machineId` no es el de ese proceso. Un `goto` a loopback, red privada o un nombre `.internal` no se ejecuta. `POST /task/cancel` con el mismo token y la misma máquina aborta la tarea en curso.

Eso se prueba contra el handler real en `127.0.0.1`. No abre el escritorio de esta sesión ni una aerolínea, y no acredita una tarifa.

## Para un piloto

Hace falta, por empresa, una máquina identificada, un token solo de esa máquina, y una URL alcanzable desde la app que no sea la red privada de Fly. El alta sigue detrás de `FLY_DRY_RUN=false` y `--confirmo-gasto`. Este cambio no la hace y no fija un precio.
