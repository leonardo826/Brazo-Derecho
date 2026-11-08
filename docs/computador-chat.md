# Computador desde el chat

La especialidad contable orienta. No impide una tarea que el computador de esa empresa pueda ejecutar. Comprar, pagar, declarar, enviar o un cambio irreversible sigue pidiendo confirmación. Entrar a un sitio no autoriza esas acciones.

El chat no inventa una tarifa. Solo muestra un resultado si el computador de la organización respondió `DONE`, con `xaiMode` `live` y al menos un paso. Si no hay máquina en marcha, la respuesta dice que no entró a ningún sitio. Un simulador no cuenta como tarifa.

La dirección sale de la fila `Computer` de esa organización: `status` `RUNNING`, `flyApp` y `machineId` presentes. La URL es `http://<flyApp>.internal:8787`. No se usa `COMPUTER_AGENT_URL` ni `COMPUTER_AGENT_TOKEN`: son valores globales y no aíslan al cliente. El cuerpo hacia `/task` lleva solo el objetivo. No lleva claves, grants ni el identificador de otra empresa.

## Qué no está conectado

El relleno de la Bóveda (`POST /api/credenciales/rellenar`) sigue existiendo para el agente, pero el chat no lo llama. Un acceso guardado no se inyecta en el navegador desde esta conversación. Conectarlo ahora, sin un token por empresa y sin una máquina aislada, abriría una ruta con un secreto compartido. Queda pendiente.

Tampoco hay token por organización. Si la máquina exige `AGENT_RUNTIME_TOKEN`, esta llamada llega sin `Authorization` y el rechazo se informa como fallo. No se reutiliza el token global.

## Para un piloto real

Hace falta, por cada empresa, una máquina y un volumen propios, la fila `Computer` en `RUNNING` con `flyApp` y `machineId`, red privada hasta el puerto 8787, y el runtime en modo live (no mock). El alta en Fly sigue detrás de `FLY_DRY_RUN=false` y `--confirmo-gasto`. Este cambio no crea esa máquina, no gasta y no lee el entorno de producción.

La prueba de una cotización real es app, computador de esa empresa, aerolínea y tarifa con fuente. Los tests de este repositorio solo fijan la conexión y el rechazo honesto.
