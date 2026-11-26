# Computador desde el chat

La especialidad contable orienta. No impide una tarea pública que el computador de esa empresa pueda ejecutar. Si falta un dato indispensable, se pregunta solo eso y el turno siguiente sigue la misma intención, aislada por persona, empresa e hilo. Comprar, pagar, declarar, enviar o un cambio irreversible pide confirmación. Entrar a un sitio no autoriza esas acciones.

## Quién puede registrar

No hay un POST para que un miembro de la empresa anote una URL y la deje en marcha. El alta es `enrollComputerLease`, solo código de servidor. Hoy no lo llama un usuario ni el script de Fly: ese script imprime el plan y termina. `XAI_MODE=mock` no es un resultado.

Antes de guardar `RUNNING`, el servidor manda un nonce a `POST /handshake` y comprueba `HMAC-SHA256` del token que ya está en la máquina. No envía el token en esa llamada, no sigue redirects y no copia un `status: RUNNING` que la máquina se atribuya. Si la empresa está suspendida, si quien enrola no es dueño ni admin de plataforma, si el nombre resuelve a una IP privada, local o IPv6 privada, o si el origen no es `https`, no activa. `127.0.0.1` solo se acepta cuando el proceso de prueba pasa la marca interna del harness. No depende de `NODE_ENV`. `loadTenantLease` sin esa marca no usa un loopback aunque la fila diga `RUNNING`. `STOPPED` y `ERROR` salen `detenido` y no se llaman.

El token va cifrado con AES-GCM y AAD `v1`, empresa y máquina. Otra empresa, otra máquina o un cifrado cambiado no descifra. `STOPPED` o `ERROR` no se llaman. Una máquina ya registrada no se la queda otra empresa: el choque del índice único es un rechazo, no un 500.

## Qué sigue abierto

La intención pendiente vive en memoria de un proceso y no dura en serverless. Citar el host de un `goto` no es una tarifa. Un click o una tecla pueden salir del sitio después de un `goto` público. Si el tiempo se agota o la persona detiene el turno, se llama a `/task/cancel` una vez y el resultado que llegue después se descarta. Cada acción del runtime tiene que estar autorizada: `/action` solo corre con el token, la máquina y una tarea viva. El consumo por paso y la Bóveda desde el chat siguen aparte. El piloto sigue limitado a una empresa `isQa`. Nada de eso enciende el computador en producción: hace falta `COMPUTER_FEATURE_ENABLED=true`.

Un resultado del chat solo se acepta con `DONE`, `xaiMode: live` y un `goto` público citado. El simulador no cuenta. Una cookie en el navegador de la máquina no aísla un secreto.

## Runtime local y piloto

El handler rechaza si falta el token o si la máquina no coincide. El cableado de prueba usa `127.0.0.1` y está rotulado como cableado, no como navegación. Un piloto real sigue exigiendo una máquina propia, un token de esa máquina y un `https` alcanzable que no sea la red privada de Fly. Este cambio no la compra y no fija un precio.
