#!/usr/bin/env bash
# Bloquea salida del usuario iabot hacia metadatos, loopback:8787 y redes privadas.
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

reject4() {
  local spec="$1"
  shift
  if ! iptables -C OUTPUT -m owner --uid-owner "$uid" "$@" -d "$spec" -j REJECT >/dev/null 2>&1; then
    iptables -A OUTPUT -m owner --uid-owner "$uid" "$@" -d "$spec" -j REJECT
  fi
}

reject6() {
  local spec="$1"
  shift
  if ! ip6tables -C OUTPUT -m owner --uid-owner "$uid" "$@" -d "$spec" -j REJECT >/dev/null 2>&1; then
    ip6tables -A OUTPUT -m owner --uid-owner "$uid" "$@" -d "$spec" -j REJECT
  fi
}

reject4 169.254.0.0/16
reject4 10.0.0.0/8
reject4 172.16.0.0/12
reject4 192.168.0.0/16
reject4 100.64.0.0/10
reject4 192.88.99.0/24
reject4 0.0.0.0/8
reject4 127.0.0.0/8 -p tcp --dport 8787
reject6 fe80::/10
reject6 fc00::/7
reject6 2001:db8::/32
reject6 2001::/32
reject6 64:ff9b:1::/48
reject6 ::1 -p tcp --dport 8787
