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
apt-get install -y ca-certificates curl gnupg nginx
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

cd /opt/iabot-machine-agent
export PLAYWRIGHT_BROWSERS_PATH=/opt/iabot-machine-agent/browsers
npm install --omit=dev
npx playwright install --with-deps chromium
chown -R iabot:iabot /opt/iabot-machine-agent /var/lib/iabot-machine-agent

install -d -o root -g iabot -m 0750 /etc/iabot-machine-agent
install -d -o root -g iabot -m 0750 /etc/iabot-machine-agent/tls
if [[ ! -f /etc/iabot-machine-agent.env ]]; then
  cat > /etc/iabot-machine-agent.env <<'EOF'
AGENT_RUNTIME_TOKEN=
MACHINE_ID=
LEASE_EPOCH=1
PORT=8787
BIND=127.0.0.1
EOF
  chown root:iabot /etc/iabot-machine-agent.env
  chmod 0640 /etc/iabot-machine-agent.env
fi

if [[ -n "${DOMAIN}" ]]; then
  sed "s/MACHINE_AGENT_DOMAIN/${DOMAIN}/g" "${SOURCE}/nginx/iabot-machine-agent.conf" > /etc/nginx/sites-available/iabot-machine-agent.conf
  ln -sfn /etc/nginx/sites-available/iabot-machine-agent.conf /etc/nginx/sites-enabled/iabot-machine-agent.conf
  rm -f /etc/nginx/sites-enabled/default
fi

install -m 0644 "${SOURCE}/systemd/iabot-machine-agent.service" /etc/systemd/system/iabot-machine-agent.service
systemctl daemon-reload
systemctl enable iabot-machine-agent

if [[ -n "${DOMAIN}" ]]; then
  if nginx -t; then
    systemctl enable nginx
    systemctl reload nginx
  else
    echo "nginx todavía no tiene el certificado. Colócalo y vuelve a cargar nginx." >&2
  fi
fi

if grep -Eq '^AGENT_RUNTIME_TOKEN=.+' /etc/iabot-machine-agent.env && grep -Eq '^MACHINE_ID=.+' /etc/iabot-machine-agent.env; then
  systemctl restart iabot-machine-agent
else
  echo "Completa /etc/iabot-machine-agent.env y luego: systemctl start iabot-machine-agent" >&2
fi
