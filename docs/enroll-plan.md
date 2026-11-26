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

`MACHINE_AGENT_DOMAIN` es el nombre de esa carpeta, sin ruta. El alta de cada cliente usa su propia empresa, su `MACHINE_ID` y el token de ese VPS. El procedimiento del VPS está en `README-machine-agent.md`. Este documento no toca los VPS.

El computador de una empresa queda activo solo si `COMPUTER_FEATURE_ENABLED` es exactamente `true` y el id de esa empresa está en `COMPUTER_ENABLED_ORGS`. La lista son ids separados por coma. Si la variable no está, está en blanco o solo tiene comas, no entra nadie. Con el flag en cualquier otro valor, tampoco entra nadie, aunque la lista tenga ids.

## Alta en la app

El script `scripts/qa-enroll.ts` corre en el build, después de `prisma migrate deploy` y antes de `next build` (`vercel.json` y `npm run build`). Si no están las variables, sale sin hacer nada y el build sigue. Si está alguna y falta otra, el build falla: no deja un alta a medias. No llama al VPS y no hace handshake. Cifra cada token con `CREDENTIALS_MASTER_KEY` (AES-256-GCM, AAD `v1`, empresa y máquina), comprueba el endpoint con las mismas reglas que rechazan un origen privado, y no crea una segunda fila si esa empresa ya tiene esa máquina en `RUNNING`. En las empresas del JSON pone `isQa = true` y no toca ninguna otra. Repetir el deploy las deja en true. El log solo dice `qa-enroll orgId=<id> OK` o `qa-enroll orgId=<id> ERROR`. No imprime el token, la URL, el nombre de la máquina ni la clave.

Si el DNS de un endpoint no resuelve, esa empresa queda en `ERROR`, las otras siguen y el deploy no se corta. El siguiente deploy vuelve a intentar esa empresa. Un origen privado o inválido sí detiene el build.

La época que escribe es 1. En el VPS, `LEASE_EPOCH` tiene que ser 1 y `MACHINE_ID` el `machineName` de esa empresa. Si no coinciden, la tarea responde 409. El script no rota el token: para cambiarlo se usa `scripts/computer-lease-admin.ts rotate`.

### 1. Crear las tres empresas

Registro normal en `/registro`, una cuenta por cliente de prueba. No actives la prueba de 7 días y no pagues. Anota el `id` de cada `Organization` y ponlo en `QA_ENROLL_SPEC`.

El script marca `isQa` solo en esas tres empresas. Con eso el arriendo se lee, Contador, Marketing y WhatsApp abren sin prueba ni pago, y no se factura. No hace falta un `UPDATE` en la base. Una empresa que no esté en el JSON no cambia.

### 2. Cargar variables

En Vercel, Production. Los tres tokens y `CREDENTIALS_MASTER_KEY` son Sensitive. El token de cada VPS es `AGENT_RUNTIME_TOKEN` en `/etc/iabot-machine-agent.env`. No lo pegues en el JSON, no lo commitees y no lo escribas en un log.

`QA_ENROLL_SPEC` no lleva secretos:

```json
{
  "A": { "orgId": "ID_ORG_A", "endpoint": "https://64-176-27-253.sslip.io", "machineName": "MACHINE_ID_A" },
  "B": { "orgId": "ID_ORG_B", "endpoint": "https://64-176-26-74.sslip.io", "machineName": "MACHINE_ID_B" },
  "C": { "orgId": "ID_ORG_C", "endpoint": "https://64-176-28-67.sslip.io", "machineName": "MACHINE_ID_C" }
}
```

El endpoint es `https` y el host del certificado, sin ruta y sin usuario. `machineName` es el `MACHINE_ID` que ya está en ese VPS (letras, números, `_` y `-`, de 4 a 80).

Además:

- `QA_ENROLL_TOKEN_A`, `QA_ENROLL_TOKEN_B`, `QA_ENROLL_TOKEN_C`
- `COMPUTER_FEATURE_ENABLED=true`
- `COMPUTER_ENABLED_ORGS=ID_ORG_A,ID_ORG_B,ID_ORG_C`
- `COMPUTER_PANEL=true` para que el enlace «Ver mi computador» salga en producción
- `CREDENTIALS_MASTER_KEY` ya tiene que existir. Si falta, el alta falla y no guarda el token en claro.

### 3. Deploy

El build corre el script. En el log del deploy tienen que aparecer tres líneas `qa-enroll orgId=... OK` y ninguna otra línea de ese script. Si una dice `ERROR` porque el DNS no resolvió, las otras pueden decir `OK` y el deploy igual termina: el siguiente deploy reintenta la que falló. Un segundo deploy de las mismas variables no crea otra máquina y no vuelve a cambiar `isQa`: vuelve a decir OK y no escribe de nuevo.

### 4. Verificar

No selecciones las columnas del token.

```sql
select id, "isQa" from "Organization" where id in ('ID_ORG_A', 'ID_ORG_B', 'ID_ORG_C');
select "clientId", "machineId", status, "leaseEpoch"
from "Computer"
where "clientId" in ('ID_ORG_A', 'ID_ORG_B', 'ID_ORG_C');
```

Las tres empresas quedan `isQa`. Ninguna otra empresa cambia esa marca.

Tres filas `RUNNING`, época 1, cada `machineId` el de su VPS. Desde otra máquina, sin mandar el token:

```bash
curl --fail --silent --show-error https://64-176-27-253.sslip.io/status
```

Tiene que responder 401. Lo mismo en los otros dos hosts. Entra con cada una de las tres cuentas: `/panel/computador` abre. Con una cuarta empresa, o con una que no esté en la lista, esa URL responde 404.

### 5. Prueba de tres usuarios

Cada persona usa solo su empresa. Contador, Marketing y WhatsApp de esa empresa comparten el VPS y no comparten perfil. Pide en el Contador una tarea de computador y confirma que habla con el host de esa org, no con el de otra. La empresa que no está en `COMPUTER_ENABLED_ORGS` no ve el enlace y el chat no llama a ninguna máquina.

### 6. Revocar

Hazlo en este orden. Si las variables de alta siguen puestas, el siguiente build no reescribe una fila que ya no coincide y el deploy falla.

1. Borra `QA_ENROLL_SPEC`, `QA_ENROLL_TOKEN_A`, `QA_ENROLL_TOKEN_B` y `QA_ENROLL_TOKEN_C`.
2. Revoca el arriendo de cada empresa. La época es la que está en la base (1 si no se rotó):

```bash
npx tsx scripts/computer-lease-admin.ts revoke \
  --operator ops-1 \
  --actor USER_ID \
  --client ID_ORG \
  --machine MACHINE_ID \
  --epoch 1
```

Eso deja la fila en `STOPPED`, borra el token cifrado y sube la época. No imprime el token. Quien revoca es dueño de esa empresa o un admin de `ADMIN_EMAILS`.

3. Quita los tres ids de `COMPUTER_ENABLED_ORGS`. Si la dejas vacía, no entra nadie.
4. Deploy. El script ya no tiene variables y no toca la base.

### 7. Flag apagado

Deja `COMPUTER_FEATURE_ENABLED` en cualquier valor que no sea exactamente `true`, o bórrala, y haz deploy. El computador queda apagado para todas las empresas, también las que sigan en la lista. La UI, las rutas, el chat y el cron de inactividad no llaman a las máquinas. Para volver a probar hay que poner el flag en `true` y listar otra vez los ids.
