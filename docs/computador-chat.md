# Computador desde el chat

La especialidad contable orienta. No impide una tarea pública que el computador de esa empresa pueda ejecutar. Si falta un dato indispensable, se pregunta solo eso y el turno siguiente sigue la misma intención, aislada por persona, empresa e hilo. Comprar, pagar, declarar, enviar o un cambio irreversible pide confirmación. Entrar a un sitio no autoriza esas acciones.

## Quién puede registrar

No hay un POST para que un miembro de la empresa anote una URL y la deje en marcha. El alta es `enrollComputerLease`, solo código de servidor. Hoy no lo llama un usuario ni el script de Fly: ese script imprime el plan y termina. `XAI_MODE=mock` no es un resultado.

Antes de guardar `RUNNING`, el servidor llama `GET /status` con el token, no sigue redirects, y exige el mismo `machineId`. Si la empresa está suspendida, si el nombre resuelve a una IP privada o local, o si el origen no es `https`, no activa. `127.0.0.1` solo se acepta cuando el proceso de prueba pasa `allowLoopback: true`. No depende de `NODE_ENV`. `loadTenantLease` sin esa marca no usa un loopback aunque la fila diga `RUNNING`.

El token va cifrado con AES-GCM y AAD `v1`, empresa y máquina. Otra empresa, otra máquina o un cifrado cambiado no descifra. `STOPPED` o `ERROR` no se llaman. Una máquina ya registrada no se la queda otra empresa: el choque del índice único es un rechazo, no un 500.

## Qué sigue abierto

La intención pendiente vive en memoria de un proceso y no dura en serverless. Citar el host de un `goto` no es una tarifa. Un click o una tecla pueden salir del sitio después. Si el tiempo se agota sin abort, no se llama a `/task/cancel`. El runtime aún no autoriza cada acción ni mide el consumo por paso. La Bóveda no se inyecta desde el chat. El permiso por acción, más allá del texto, queda para la iteración siguiente. Nada de eso es capacidad real.

Un resultado del chat solo se acepta con `DONE`, `xaiMode: live` y un `goto` público citado. El simulador no cuenta. Una cookie en el navegador de la máquina no aísla un secreto.

## Runtime local y piloto

El handler rechaza si falta el token o si la máquina no coincide. El cableado de prueba usa `127.0.0.1` y está rotulado como cableado, no como navegación. Un piloto real sigue exigiendo una máquina propia, un token de esa máquina y un `https` alcanzable que no sea la red privada de Fly. Este cambio no la compra y no fija un precio.
