# Computador desde el chat

La especialidad contable orienta. No impide una tarea pública que el computador de esa empresa pueda ejecutar. Si falta un dato indispensable, se pregunta solo eso y el turno siguiente sigue la misma intención, aislada por persona, empresa e hilo. Comprar, pagar, declarar, enviar o un cambio irreversible pide confirmación. Entrar a un sitio no autoriza esas acciones.

## Qué está deshabilitado a propósito

La app no llama a `*.internal`. Esa dirección pertenece a la red privada de Fly y desde el proceso de la app no hay una conexión acreditada. La fila `Computer` tampoco guarda un token de esa máquina. Sin las dos cosas, el chat responde que no entró a ningún sitio. No usa `COMPUTER_AGENT_URL` ni `COMPUTER_AGENT_TOKEN`.

Un resultado solo se acepta si el runtime responde `DONE`, `xaiMode: live`, y un paso `goto` a una URL pública cuyo nombre aparece en el texto. Una captura inicial no alcanza. El simulador no cuenta.

El relleno de la Bóveda no sale del chat. Una cookie que ya viva en el navegador de una máquina no demuestra que el secreto quedó aislado. El chat no envía claves.

## Runtime local

`agent-runtime` rechaza la petición si falta `AGENT_RUNTIME_TOKEN` o si `machineId` no es el de ese proceso. Un `goto` a loopback, red privada o un nombre `.internal` no se ejecuta. `POST /task/cancel` con el mismo token y la misma máquina aborta la tarea en curso.

Eso se prueba contra el handler real en `127.0.0.1`. No abre el escritorio de esta sesión ni una aerolínea, y no acredita una tarifa.

## Para un piloto

Hace falta, por empresa, una máquina identificada, un token solo de esa máquina, y una URL alcanzable desde la app que no sea la red privada de Fly. El alta sigue detrás de `FLY_DRY_RUN=false` y `--confirmo-gasto`. Este cambio no la hace y no fija un precio.
