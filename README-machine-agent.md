# Agente de máquina

Servicio Node para un VPS con Ubuntu 24.04. El proceso escucha en `127.0.0.1:8787`. nginx publica solo el 443. Chromium headless abre páginas públicas a través de un proxy local que resuelve el DNS, rechaza una IP privada y no sigue un salto hacia ella. El código de `/opt/iabot-machine-agent` queda de root y no lo puede escribir `iabot`.

`COMPUTER_FEATURE_ENABLED` de la app no cambia con esta instalación. Solo vale si es exactamente `true`.

## Qué exige el protocolo

Cada request lleva `x-iabot-timestamp`, `x-iabot-nonce`, `x-iabot-host` y `x-iabot-signature`. La firma es HMAC-SHA256 del token sobre timestamp, nonce, método, ruta, hash del cuerpo y host. El token no viaja. El host tiene que ser `MACHINE_AGENT_DOMAIN`. Un nonce no se repite y el reloj admite 60 segundos.

`POST /handshake` también va firmado. La respuesta prueba `HMAC(token, nonce + salto + machineId + host)`. Un `status: RUNNING` que declare la máquina no cuenta. `LEASE_EPOCH` vacío rechaza la tarea, el cancel y la acción. `/action` además exige la época y una tarea viva.

Durante una rotación el VPS acepta `AGENT_RUNTIME_TOKEN` y `AGENT_RUNTIME_TOKEN_PREVIOUS`.

## 1. Instalar en un Ubuntu 24.04 nuevo

El nombre DNS, por ejemplo `vm.ejemplo.cl`, apunta a la IPv4 del VPS. Como root:

```bash
apt-get update
apt-get install -y git
git clone https://github.com/leonardo826/Brazo-Derecho.git /opt/brazo-src
cd /opt/brazo-src
git checkout cursor/computer-lease-secure-4691
MACHINE_AGENT_DOMAIN=vm.ejemplo.cl bash machine-agent/install-ubuntu-24.04.sh
```

El instalador usa el repositorio firmado de NodeSource, no un `curl | bash`. Deja ufw con el 443 abierto y el 22 abierto. Para no abrir el 22: `MACHINE_AGENT_ALLOW_SSH=0` delante del instalador, cuando el acceso no dependa de SSH. También aplica reglas de salida para el usuario `iabot`: metadatos `169.254.0.0/16`, redes privadas y el loopback hacia el puerto 8787.

Chromium conserva su sandbox. Hace falta user namespace. En Ubuntu 24.04 AppArmor lo restringe; el instalador carga un perfil que permite `userns` solo a ese binario. systemd no pone `RestrictNamespaces` porque el sandbox de Chromium lo necesita. El resto del servicio queda con `ProtectSystem=strict`, `ProtectHome`, `PrivateDevices`, `CapabilityBoundingSet` vacío y familias de red limitadas. `AF_NETLINK` se deja porque el sandbox de Chromium lo usa.

El token se genera en un archivo y no entra en la shell:

```bash
umask 077
openssl rand -base64 32 > /root/iabot-token-new
/opt/iabot-machine-agent/rotate-token.sh init maq-empresa-1 vm.ejemplo.cl
```

`maq-empresa-1` es el `MACHINE_ID` (letras, números, `_` y `-`, de 4 a 80). La época inicial es 1.

Certificado:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot certonly --nginx -d vm.ejemplo.cl
install -d -m 0750 -o root -g iabot /etc/iabot-machine-agent/tls
cp /etc/letsencrypt/live/vm.ejemplo.cl/fullchain.pem /etc/iabot-machine-agent/tls/fullchain.pem
cp /etc/letsencrypt/live/vm.ejemplo.cl/privkey.pem /etc/iabot-machine-agent/tls/privkey.pem
chown root:iabot /etc/iabot-machine-agent/tls/fullchain.pem /etc/iabot-machine-agent/tls/privkey.pem
chmod 0640 /etc/iabot-machine-agent/tls/fullchain.pem /etc/iabot-machine-agent/tls/privkey.pem
nginx -t && systemctl reload nginx
systemctl restart iabot-machine-agent
```

Desde otra máquina, sin mandar el token:

```bash
curl --fail --silent --show-error https://vm.ejemplo.cl/status
```

Tiene que responder 401.

## 2. Enrolar

En un puesto con el repo, `DATABASE_URL` y `CREDENTIALS_MASTER_KEY`. La empresa tiene que estar marcada `isQa` y no suspendida. Quien enrola es dueño (`OWNER`) o un admin de plataforma (`ADMIN_EMAILS`).

```sql
select u.id as user_id, o.id as organization_id
from "User" u
join "Membership" m on m."userId" = u.id
join "Organization" o on o.id = m."organizationId"
where m.role = 'OWNER' and o."isQa" = true and o."suspendedAt" is null;
```

Copia `/root/iabot-token-new` a ese puesto por `scp`, con modo `0600`. El comando lee el token por stdin. No lo exportes y no lo pongas en los argumentos.

```bash
npx tsx scripts/computer-lease-admin.ts enroll \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --endpoint https://vm.ejemplo.cl \
  --attest-ownership < /root/iabot-token-new
```

La salida trae `leaseEpoch` y no trae el token. Si no es `1`, en el VPS:

```bash
/opt/iabot-machine-agent/rotate-token.sh finish EPOCA
```

Eso escribe `LEASE_EPOCH`, borra el archivo del token y reinicia. `--epoch` es obligatorio para revocar.

## 3. Rotar

El VPS tiene que aceptar el token viejo y el nuevo antes de que la app deje de usar el viejo.

1. En el puesto de operación: `umask 077 && openssl rand -base64 32 > /root/iabot-token-new`
2. `scp` de ese archivo a `/root/iabot-token-new` en el VPS.
3. En el VPS: `/opt/iabot-machine-agent/rotate-token.sh apply`  
   Guarda el token actual en `AGENT_RUNTIME_TOKEN_PREVIOUS`, pone el nuevo en `AGENT_RUNTIME_TOKEN` y reinicia. No imprime el token.
4. En el puesto, con la época que está en la base:

```bash
npx tsx scripts/computer-lease-admin.ts rotate \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --endpoint https://vm.ejemplo.cl \
  --epoch EPOCA_ACTUAL \
  --attest-ownership < /root/iabot-token-new
```

5. Cuando la salida traiga la época nueva, en el VPS: `/opt/iabot-machine-agent/rotate-token.sh finish EPOCA_NUEVA`  
   Quita el token anterior, fija la época y borra `/root/iabot-token-new`.

Si el paso 4 falla, la app sigue firmando con el token viejo y el VPS todavía lo acepta como previous.

Para revocar, la época es obligatoria y la auditoría queda en la misma transacción que el borrado:

```bash
npx tsx scripts/computer-lease-admin.ts revoke \
  --operator ops-1 \
  --actor USER_ID \
  --client ORGANIZATION_ID \
  --machine maq-empresa-1 \
  --epoch EPOCA_ACTUAL
```

## 4. Actualizar un VPS que ya tiene f134457 y no está enrolado

En cada uno de los tres VPS, como root. No borres `/etc/iabot-machine-agent.env` si ya tiene token: el instalador no lo pisa. Sí agrega `MACHINE_AGENT_DOMAIN` si falta.

```bash
cd /opt/brazo-src
git fetch origin cursor/computer-lease-secure-4691
git checkout cursor/computer-lease-secure-4691
MACHINE_AGENT_DOMAIN=vm.ejemplo.cl bash machine-agent/install-ubuntu-24.04.sh
/opt/iabot-machine-agent/rotate-token.sh init maq-empresa-1 vm.ejemplo.cl
```

`rotate-token.sh init` solo si todavía no hay token, y después de crear `/root/iabot-token-new`. Si el entorno ya tiene token y máquina, no corras `init`: deja el archivo y reinicia el servicio.

```bash
nginx -t && systemctl reload nginx
systemctl restart iabot-machine-agent
systemctl status iabot-machine-agent --no-pager
```

El checkout `cursor/computer-lease-secure-4691` tiene que ser el commit nuevo del PR, no `f134457`. Comprueba con `git rev-parse HEAD`. Después enrola con el paso 2. Hasta entonces la app no llama a esa máquina.
