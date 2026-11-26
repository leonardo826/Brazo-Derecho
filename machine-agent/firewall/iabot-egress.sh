#!/usr/bin/env bash
# Escribe before.rules y before6.rules solo si iptables-restore --test acepta el resultado.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta el firewall como root." >&2
  exit 1
fi
if ! id iabot >/dev/null 2>&1; then
  echo "Falta el usuario iabot." >&2
  exit 1
fi

uid="$(id -u iabot)"
resolver="$(awk '/^nameserver[ \t]+[0-9.]+$/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)"
resolver="${resolver:-127.0.0.53}"
resolver6="$(awk '/^nameserver[ \t]+[0-9a-fA-F:]+$/ { if ($2 ~ /:/) { print $2; exit } }' /etc/resolv.conf 2>/dev/null || true)"
render="${IABOT_RENDER:-/usr/local/lib/iabot/render-ufw.mjs}"
v4="/etc/ufw/before.rules"
v6="/etc/ufw/before6.rules"

if [[ ! -f "$v4" || ! -f "$v6" ]]; then
  echo "Faltan before.rules o before6.rules. No se toca ufw." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
node "$render" --family v4 --uid "$uid" --resolver "$resolver" --input "$v4" > "$work/before.rules"
node "$render" --family v6 --uid "$uid" --resolver "$resolver6" --input "$v6" > "$work/before6.rules"

if ! iptables-restore --test < "$work/before.rules"; then
  echo "iptables-restore --test rechazó before.rules. No se toca ufw." >&2
  exit 1
fi
if ! ip6tables-restore --test < "$work/before6.rules"; then
  echo "ip6tables-restore --test rechazó before6.rules. No se toca ufw." >&2
  exit 1
fi

cp "$work/before.rules" "$v4"
cp "$work/before6.rules" "$v6"
