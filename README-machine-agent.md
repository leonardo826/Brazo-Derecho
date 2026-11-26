# Agente de máquina

Servicio Node mínimo para un VPS con Ubuntu 24.04. Escucha en `127.0.0.1:8787`, nginx publica HTTPS, y Chromium headless (Playwright) abre solo páginas públicas. El interruptor `COMPUTER_FEATURE_ENABLED` de la app sigue apagado: este alta no lo enciende y no despliega la app.

La app no manda el token en el alta. Manda un nonce. La máquina responde `HMAC-SHA256(token, nonce + "\\n" + machineId)`. Solo después de esa prueba la app guarda el token cifrado y marca `RUNNING`. Un `status: RUNNING` que declare la máquina no cuenta.

## 1. Preparar el VPS

Un Ubuntu 24.04 vacío, con un nombre DNS público (por ejemplo `vm.ejemplo.cl`) apuntando a su IPv4. Entra como root y clona el repo, o copia la carpeta `machine-agent/`.

```bash
apt-get update
apt-get install -y git
git clone https://github.com/leonardo826/Brazo-Derecho.git /opt/brazo-src
cd /opt/brazo-src
MACHINE_AGENT_DOMAIN=vm.ejemplo.cl bash machine-agent/install-ubuntu-24.04.sh
```

El script crea el usuario `iabot`, instala Node 22 si hace falta, Chromium y nginx. No imprime el token.

Genera el token en el VPS y escríbelo solo en el archivo de entorno, modo `0640`:

```bash
TOKEN="$(openssl rand -base64 32)"
install -d -m 0750 -o root -g iabot /etc/iabot-machine-agent
umask 027
cat > /etc/iabot-machine-agent.env <<EOF
AGENT_RUNTIME_TOKEN=${TOKEN}
MACHINE_ID=maq-empresa-1
LEASE_EPOCH=1
PORT=8787
BIND=127.0.0.1
EOF
chown root:iabot /etc/iabot-machine-agent.env
chmod 0640 /etc/iabot-machine-agent.env
unset TOKEN
```

`MACHINE_ID` es el id que vas a pasar en el alta (`letras`, números, `_` y `-`, de 4 a 80). `LEASE_EPOCH=1` corresponde al primer alta. No pongas el token en la línea de comandos de la app.

Certificado para ese nombre. Con los puertos 80 y 443 abiertos:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot certonly --nginx -d vm.ejemplo.cl
install -d -m 0750 -o root -g iabot /etc/iabot-machine-agent/tls
cp /etc/letsencrypt/live/vm.ejemplo.cl/fullchain.pem /etc/iabot-machine-agent/tls/fullchain.pem
cp /etc/letsencrypt/live/vm.ejemplo.cl/privkey.pem /etc/iabot-machine-agent/tls/privkey.pem
chown root:iabot /etc/iabot-machine-agent/tls/fullchain.pem /etc/iabot-machine-agent/tls/privkey.pem
chmod 0640 /etc/iabot-machine-agent/tls/fullchain.pem /etc/iabot-machine-agent/tls/privkey.pem
nginx -t
systemctl reload nginx
systemctl restart iabot-machine-agent
systemctl status iabot-machine-agent --no-pager
```

El agente no debe quedar expuesto en el puerto 8787. Solo nginx en 443. Comprueba desde otra máquina:

```bash
curl --fail --silent --show-error https://vm.ejemplo.cl/status
```

Sin `Authorization` tiene que responder 401. No hace falta —ni conviene— mandar el token en ese `curl`.

## 2. Enrolarla en la app

Hazlo desde un puesto con el repo, `DATABASE_URL` y `CREDENTIALS_MASTER_KEY` de 32 bytes en base64. No hace falta `COMPUTER_FEATURE_ENABLED`.

El piloto solo acepta una empresa con `isQa` y sin suspensión. Quien enrola tiene que ser dueño (`OWNER`) de esa empresa, o un admin de plataforma (`ADMIN_EMAILS`). Un miembro `STAFF` recibe `permiso`.

```sql
select u.id as user_id, o.id as organization_id
from "User" u
join "Membership" m on m."userId" = u.id
join "Organization" o on o.id = m."organizationId"
where m.role = 'OWNER' and o."isQa" = true and o."suspendedAt" is null;
```

Copia el mismo token del VPS al entorno de este comando. No lo pongas en los argumentos: si aparece en `argv`, el comando se niega y no lo imprime.

```bash
export COMPUTER_LEASE_TOKEN='el-mismo-token-del-vps'
npx tsx scripts/computer-lease-admin.ts enroll \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --endpoint https://vm.ejemplo.cl \
  --attest-ownership
unset COMPUTER_LEASE_TOKEN
```

La salida es una línea JSON con `outcome` y `leaseEpoch`. No trae el token ni la URL. Si `leaseEpoch` no es `1`, actualiza `LEASE_EPOCH` en el VPS y reinicia:

```bash
systemctl restart iabot-machine-agent
```

Una empresa tiene una sola máquina. Otra empresa no puede registrar el mismo `machineId`.

Para rotar, pasa la época que acabas de ver:

```bash
export COMPUTER_LEASE_TOKEN='el-token-nuevo'
npx tsx scripts/computer-lease-admin.ts rotate \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --endpoint https://vm.ejemplo.cl \
  --epoch EPOCA_ACTUAL \
  --attest-ownership
unset COMPUTER_LEASE_TOKEN
```

Escribe el token nuevo en `/etc/iabot-machine-agent.env`, pon `LEASE_EPOCH` en el valor nuevo y reinicia. Para revocar:

```bash
npx tsx scripts/computer-lease-admin.ts revoke \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --epoch EPOCA_ACTUAL
```

`STOPPED` y `ERROR` no se llaman. El chat sigue sin usar la máquina mientras `COMPUTER_FEATURE_ENABLED` no sea exactamente `true`.

## Qué hace el servicio

- `POST /handshake` sin `Authorization`. Responde `machineId`, `nonce` y `proof`.
- `GET /status`, `POST /task`, `POST /task/cancel` y `POST /action` exigen `Bearer` y el mismo `machineId`.
- `POST /task` y `POST /action` también exigen `epoch` igual a `LEASE_EPOCH`.
- `POST /action` solo corre mientras esa `taskId` está en curso.
- Playwright abre la primera URL `https` pública del pedido. Rechaza loopback, red privada, link-local e IPv6 privada, y no sigue un salto hacia ahí.
- El token no se escribe en stdout ni en el resultado.
