#!/usr/bin/env bash
# Cambia el token sin imprimirlo y sin pasarlo por la línea de comandos.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta la rotación como root." >&2
  exit 1
fi

ENV_FILE=/etc/iabot-machine-agent.env
NEW_FILE=/root/iabot-token-new
mode="${1:-}"

if [[ "$mode" == "init" ]]; then
  machine="${2:-}"
  domain="${3:-}"
  if [[ ! "$machine" =~ ^[A-Za-z0-9_-]{4,80}$ || ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "Uso: rotate-token.sh init MACHINE_ID DOMINIO" >&2
    exit 1
  fi
  if [[ ! -f "$NEW_FILE" ]]; then
    echo "Falta $NEW_FILE." >&2
    exit 1
  fi
  MACHINE_ID_NEXT="$machine" MACHINE_AGENT_DOMAIN_NEXT="$domain" node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const token = readFileSync("/root/iabot-token-new", "utf8").trim();
if (token.length < 16) process.exit(2);
const body = [
  `AGENT_RUNTIME_TOKEN=${token}`,
  `MACHINE_ID=${process.env.MACHINE_ID_NEXT}`,
  `LEASE_EPOCH=1`,
  "PORT=8787",
  "BIND=127.0.0.1",
  `MACHINE_AGENT_DOMAIN=${process.env.MACHINE_AGENT_DOMAIN_NEXT}`,
  "",
].join("\n");
writeFileSync("/etc/iabot-machine-agent.env", body, { mode: 0o640 });
EOF
  chown root:iabot "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  systemctl restart iabot-machine-agent
  echo "Entorno escrito. El token no se mostró."
  exit 0
fi

if [[ "$mode" == "apply" ]]; then
  if [[ ! -f "$NEW_FILE" || ! -f "$ENV_FILE" ]]; then
    echo "Faltan $NEW_FILE o $ENV_FILE." >&2
    exit 1
  fi
  node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
const envPath = "/etc/iabot-machine-agent.env";
const next = readFileSync("/root/iabot-token-new", "utf8").trim();
if (next.length < 16) process.exit(2);
const text = readFileSync(envPath, "utf8");
let current = "";
for (const line of text.split("\n")) {
  if (line.startsWith("AGENT_RUNTIME_TOKEN=")) current = line.slice("AGENT_RUNTIME_TOKEN=".length);
}
if (current.length < 16) process.exit(3);
const lines = [];
let sawPrevious = false;
let sawCurrent = false;
for (const line of text.split("\n")) {
  if (!line) continue;
  if (line.startsWith("AGENT_RUNTIME_TOKEN_PREVIOUS=")) {
    lines.push(`AGENT_RUNTIME_TOKEN_PREVIOUS=${current}`);
    sawPrevious = true;
  } else if (line.startsWith("AGENT_RUNTIME_TOKEN=")) {
    lines.push(`AGENT_RUNTIME_TOKEN=${next}`);
    sawCurrent = true;
  } else lines.push(line);
}
if (!sawPrevious) lines.push(`AGENT_RUNTIME_TOKEN_PREVIOUS=${current}`);
if (!sawCurrent) lines.push(`AGENT_RUNTIME_TOKEN=${next}`);
writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o640 });
EOF
  systemctl restart iabot-machine-agent
  echo "El VPS acepta el token anterior y el nuevo."
  exit 0
fi

if [[ "$mode" == "finish" ]]; then
  epoch="${2:-}"
  if [[ ! "$epoch" =~ ^[0-9]+$ ]]; then
    echo "Uso: rotate-token.sh finish EPOCA" >&2
    exit 1
  fi
  LEASE_EPOCH_NEXT="$epoch" node --input-type=module <<'EOF'
import { readFileSync, writeFileSync, rmSync } from "node:fs";
const epoch = process.env.LEASE_EPOCH_NEXT;
const envPath = "/etc/iabot-machine-agent.env";
const lines = [];
let sawEpoch = false;
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  if (!line || line.startsWith("AGENT_RUNTIME_TOKEN_PREVIOUS=")) continue;
  if (line.startsWith("LEASE_EPOCH=")) {
    lines.push(`LEASE_EPOCH=${epoch}`);
    sawEpoch = true;
  } else lines.push(line);
}
if (!sawEpoch) lines.push(`LEASE_EPOCH=${epoch}`);
writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o640 });
rmSync("/root/iabot-token-new", { force: true });
EOF
  systemctl restart iabot-machine-agent
  echo "Quedó solo el token nuevo y la época $epoch."
  exit 0
fi

echo "Uso: rotate-token.sh init MACHINE_ID DOMINIO | apply | finish EPOCA" >&2
exit 1
