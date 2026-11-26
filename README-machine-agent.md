# Agente de máquina

Servicio Node para un VPS con Ubuntu 24.04. El proceso escucha en `127.0.0.1:8787`. nginx publica solo el 443. Chromium headless abre páginas públicas a través de un proxy local que resuelve el DNS, rechaza una IP privada y no sigue un salto hacia ella. El código de `/opt/iabot-machine-agent` queda de root y no lo puede escribir `iabot`.

`COMPUTER_FEATURE_ENABLED` de la app no cambia con esta instalación. Solo vale si es exactamente `true`.

## Qué exige el protocolo

Cada request lleva `x-iabot-timestamp`, `x-iabot-nonce`, `x-iabot-host` y `x-iabot-signature`. La firma es HMAC-SHA256 del token sobre timestamp, nonce, método, ruta, hash del cuerpo y host. El token no viaja. El host tiene que ser `MACHINE_AGENT_DOMAIN`. Un nonce no se repite y el reloj admite 60 segundos.

`POST /handshake` también va firmado. La respuesta prueba `HMAC(token, nonce + salto + machineId + host)`. Un `status: RUNNING` que declare la máquina no cuenta. `LEASE_EPOCH` vacío rechaza la tarea, el cancel y la acción. `/action` además exige la época y una tarea viva.

`POST /browser/close` pide cerrar Chromium antes de un apagado por inactividad. Va firmado y exige la época. Si hay una tarea viva responde 409 y no cierra. Si no hay tarea, cierra los Chromium que el proceso todavía tenga abiertos.

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

El instalador usa el repositorio firmado de NodeSource, no un `curl | bash`. ufw abre el 80 (para renovar el certificado), el 443 y el 22. Para no abrir el 22: `MACHINE_AGENT_ALLOW_SSH=0` delante del instalador. La salida de `iabot` va a `IABOT-EGRESS` en `before.rules` (salto en `ufw-before-output`) y a `IABOT-EGRESS6` en `before6.rules` (salto en `ufw6-before-output`). El salto queda antes de `-o lo -j ACCEPT`, así el bloqueo de loopback:8787 sobrevive un reinicio. El script solo escribe esos archivos si cada salto IABOT apunta a una cadena declarada en la misma tabla y `iptables-legacy-restore --test` / `ip6tables-legacy-restore --test` aceptan las reglas (si no hay binario legacy, un restore real dentro de `unshare -n`). En un VPS que ya tiene ufw encendido el instalador hace `ufw reload`, no `ufw --force enable`, y comprueba que `iptables -S ufw-before-output` contiene `-j IABOT-EGRESS` y que `ip6tables -S ufw6-before-output` contiene `-j IABOT-EGRESS6`. Si eso falla, restaura el respaldo y vuelve a recargar. El UDP de salida se rechaza, salvo el DNS de `/etc/resolv.conf`. Chromium no anuncia direcciones locales por WebRTC (`disable_non_proxied_udp`).

Chromium conserva su sandbox. Ubuntu 24.04 trae `kernel.apparmor_restrict_unprivileged_userns=1`, así que el instalador carga un perfil AppArmor con `userns` para `chrome` y para `chrome-headless-shell` (el binario que usa Playwright en headless). systemd no pone `RestrictNamespaces` porque ese sandbox lo necesita. Para comprobarlo, con el agente en marcha:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
grep -E 'iabot-chromium|chrome-headless-shell' /sys/kernel/security/apparmor/profiles
pid="$(pgrep -f chrome-headless-shell | head -1)"
tr '\0' ' ' < "/proc/${pid}/attr/current"
```

La última línea tiene que mencionar `iabot-chromium-headless` y no un rechazo de userns en `journalctl -k`.

El token se genera en un archivo y no entra en la shell:

```bash
umask 077
openssl rand -base64 32 > /root/iabot-token-new
/opt/iabot-machine-agent/rotate-token.sh init maq-empresa-1 vm.ejemplo.cl
```

`maq-empresa-1` es el `MACHINE_ID` (letras, números, `_` y `-`, de 4 a 80). La época inicial es 1.

El certificado lo pide el instalador, no `certbot --nginx`. Primero deja nginx solo en el puerto 80 con `/.well-known/acme-challenge/`, pide el certificado por webroot y después habilita el 443 apuntando a `/etc/letsencrypt/live/<dominio>/`. Esos archivos son enlaces que Certbot renueva; un hook en `/etc/letsencrypt/renewal-hooks/deploy/iabot-nginx` recarga nginx. Si el certificado ya está en esa ruta, el instalador lo reutiliza y no pide otro.

En los tres VPS ya instalados los certificados están en:

- `/etc/letsencrypt/live/64-176-27-253.sslip.io/`
- `/etc/letsencrypt/live/64-176-26-74.sslip.io/`
- `/etc/letsencrypt/live/64-176-28-67.sslip.io/`

`MACHINE_AGENT_DOMAIN` tiene que ser exactamente ese nombre.

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

## 4. Actualizar un VPS que ya está instalado

Como root. No borres `/etc/iabot-machine-agent.env`. El instalador reutiliza `/etc/letsencrypt/live/<dominio>/` si el certificado ya está. `init` va en un bloque aparte y solo corre si no hay token.

```bash
cd /opt/brazo-src
git fetch origin cursor/computer-lease-secure-4691
git checkout --detach SHA
MACHINE_AGENT_DOMAIN=vm.ejemplo.cl bash machine-agent/install-ubuntu-24.04.sh
git rev-parse HEAD
```

```bash
if ! grep -Eq '^AGENT_RUNTIME_TOKEN=.+' /etc/iabot-machine-agent.env; then
  umask 077
  openssl rand -base64 32 > /root/iabot-token-new
  /opt/iabot-machine-agent/rotate-token.sh init maq-empresa-1 vm.ejemplo.cl
fi
```

```bash
nginx -t && systemctl reload nginx
systemctl restart iabot-machine-agent
systemctl status iabot-machine-agent --no-pager
```

`SHA` es el commit publicado con esta revisión. `git rev-parse HEAD` tiene que coincidir. Si el entorno ya tiene token, el segundo bloque no hace nada.
