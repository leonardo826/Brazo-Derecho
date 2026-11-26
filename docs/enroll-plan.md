# Alta de los computadores de prueba

Una empresa tiene un computador. El arriendo sigue siendo una fila por `organizationId` (`Computer.clientId` único). Contador, Marketing y WhatsApp de esa empresa comparten la máquina. Cada agente tiene su propio perfil de Chromium:

`/var/lib/iabot/profiles/<agentKind>`

`agentKind` solo puede ser `ACCOUNTING`, `MARKETING` o `WHATSAPP`. `/var/lib/iabot` y `profiles` son de `root:iabot` en modo `0750`. El directorio de cada agente es de `iabot`, modo `0700`. El instalador los crea. Un enlace en esa ruta no abre Chromium. Las cookies y los inicios de sesión de un agente no están en el perfil de otro. No hay una sesión de navegador única para toda la máquina.

La petición `POST /task` lleva `agentKind` en el cuerpo. Ese cuerpo entra en la firma HMAC. La máquina no abre Chromium si el valor no está en la lista.

## Los tres VPS de Santiago

Son tres clientes de prueba, no un bot por máquina. En cada uno corren Contador, Marketing y WhatsApp.

| Cliente | Papel | Certificado |
| --- | --- | --- |
| org A | Cliente de prueba | `/etc/letsencrypt/live/64-176-27-253.sslip.io/` |
| org B | Cliente de prueba | `/etc/letsencrypt/live/64-176-26-74.sslip.io/` |
| org C | Cliente de prueba | `/etc/letsencrypt/live/64-176-28-67.sslip.io/` |

`MACHINE_AGENT_DOMAIN` es el nombre de esa carpeta, sin ruta. El alta de cada cliente usa su propia empresa, su `MACHINE_ID` y el token de ese VPS. El procedimiento está en `README-machine-agent.md`.

Este documento no enciende `COMPUTER_FEATURE_ENABLED`, no toca los VPS y no fusiona nada.
