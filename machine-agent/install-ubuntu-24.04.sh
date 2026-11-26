#!/usr/bin/env bash
# Instala el agente de máquina en Ubuntu 24.04. No imprime el token.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root." >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "No pude leer /etc/os-release." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "Este instalador es para Ubuntu 24.04." >&2
  exit 1
fi

DOMAIN="${MACHINE_AGENT_DOMAIN:-}"
if [[ -n "${DOMAIN}" && ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "MACHINE_AGENT_DOMAIN tiene que ser un nombre de host." >&2
  exit 1
fi

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -d /opt/iabot-machine-agent
cp -a "${SOURCE}/." /opt/iabot-machine-agent/

if ! id iabot >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/iabot-machine-agent --shell /usr/sbin/nologin iabot
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg nginx ufw iptables apparmor certbot python3
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

install -d -o iabot -g iabot -m 0750 /var/lib/iabot-machine-agent
cd /opt/iabot-machine-agent
export PLAYWRIGHT_BROWSERS_PATH=/opt/iabot-machine-agent/browsers
npm ci --omit=dev
npx playwright install --with-deps chromium
chown -R root:root /opt/iabot-machine-agent
chmod -R u=rwX,go=rX /opt/iabot-machine-agent

install -d -o root -g iabot -m 0750 /etc/iabot-machine-agent
install -d -o root -g iabot -m 0750 /etc/iabot-machine-agent/tls
if [[ ! -f /etc/iabot-machine-agent.env ]]; then
  cat > /etc/iabot-machine-agent.env <<EOF
AGENT_RUNTIME_TOKEN=
MACHINE_ID=
LEASE_EPOCH=1
PORT=8787
BIND=127.0.0.1
MACHINE_AGENT_DOMAIN=${DOMAIN}
EOF
  chown root:iabot /etc/iabot-machine-agent.env
  chmod 0640 /etc/iabot-machine-agent.env
elif [[ -n "${DOMAIN}" ]] && ! grep -q '^MACHINE_AGENT_DOMAIN=' /etc/iabot-machine-agent.env; then
  printf 'MACHINE_AGENT_DOMAIN=%s\n' "${DOMAIN}" >> /etc/iabot-machine-agent.env
fi

install -d /usr/local/lib/iabot
install -m 0755 "${SOURCE}/firewall/iabot-egress.sh" /usr/local/sbin/iabot-egress
install -m 0644 "${SOURCE}/firewall/render-ufw.mjs" /usr/local/lib/iabot/render-ufw.mjs
install -m 0644 "${SOURCE}/systemd/iabot-egress.service" /etc/systemd/system/iabot-egress.service
install -m 0644 "${SOURCE}/apparmor/iabot-chromium" /etc/apparmor.d/iabot-chromium
if command -v apparmor_parser >/dev/null 2>&1; then
  apparmor_parser -r /etc/apparmor.d/iabot-chromium
fi
systemctl daemon-reload
systemctl enable iabot-egress
# shellcheck disable=SC1091
source "${SOURCE}/firewall/load-ufw.sh"
ufw_bak="$(mktemp -d)"
cp -a /etc/ufw/before.rules /etc/ufw/before6.rules "$ufw_bak/"
restore_ufw() {
  rollback_ufw_files "$ufw_bak" || echo "No se pudo recargar el respaldo de ufw." >&2
}
if ! /usr/local/sbin/iabot-egress; then
  restore_ufw
  echo "El firewall no se aplicó. ufw volvió a before.rules anterior." >&2
  exit 1
fi
ufw default deny incoming
ufw allow 80/tcp
ufw allow 443/tcp
if [[ "${MACHINE_AGENT_ALLOW_SSH:-1}" != "0" ]]; then
  ufw allow 22/tcp
fi
if ! run_ufw_load; then
  restore_ufw
  echo "ufw no cargó IABOT-EGRESS. Se restauraron before.rules y before6.rules." >&2
  exit 1
fi

install -d -m 0755 /var/www/html
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/iabot-nginx <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/iabot-nginx

write_nginx() {
  local mode="$1"
  if [[ "$mode" == "https" ]]; then
    sed "s/MACHINE_AGENT_DOMAIN/${DOMAIN}/g" "${SOURCE}/nginx/iabot-machine-agent.conf" > /etc/nginx/sites-available/iabot-machine-agent.conf
  else
    cat > /etc/nginx/sites-available/iabot-machine-agent.conf <<EOF
server {
  listen 80;
  server_name ${DOMAIN};
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 404; }
}
EOF
  fi
  ln -sfn /etc/nginx/sites-available/iabot-machine-agent.conf /etc/nginx/sites-enabled/iabot-machine-agent.conf
  rm -f /etc/nginx/sites-enabled/default
}

if [[ -n "${DOMAIN}" ]]; then
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" && -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]]; then
    write_nginx https
  else
    write_nginx http
    nginx -t
    systemctl enable nginx
    systemctl reload nginx || systemctl restart nginx
    certbot_args=(certonly --webroot -w /var/www/html -d "${DOMAIN}" --non-interactive --agree-tos)
    if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
      certbot_args+=(--email "${CERTBOT_EMAIL}")
    else
      certbot_args+=(--register-unsafely-without-email)
    fi
    certbot "${certbot_args[@]}"
    write_nginx https
  fi
  nginx -t
  systemctl enable nginx
  systemctl reload nginx || systemctl restart nginx
fi

install -m 0644 "${SOURCE}/systemd/iabot-machine-agent.service" /etc/systemd/system/iabot-machine-agent.service
systemctl daemon-reload
systemctl enable iabot-machine-agent

if grep -Eq '^AGENT_RUNTIME_TOKEN=.+' /etc/iabot-machine-agent.env && grep -Eq '^MACHINE_ID=.+' /etc/iabot-machine-agent.env; then
  systemctl restart iabot-machine-agent
else
  echo "Completa /etc/iabot-machine-agent.env y luego: systemctl start iabot-machine-agent" >&2
fi
