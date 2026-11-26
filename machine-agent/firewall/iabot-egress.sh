#!/usr/bin/env bash
# Escribe before.rules y before6.rules solo si cada salto IABOT apunta a una cadena
# declarada en la misma tabla y el restore legacy (o un restore real en un
# namespace) acepta esas reglas. No usa iptables-restore --test de nft: ese
# comando devuelve 0 ante un salto a una cadena que no existe.
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

chain_of() {
  if [[ "$1" == "v6" ]]; then
    printf 'IABOT-EGRESS6\nufw6-before-output\n'
  else
    printf 'IABOT-EGRESS\nufw-before-output\n'
  fi
}

own_chains_ok() {
  node "$render" --check "$1"
}

snippet_for() {
  local family="$1" rendered="$2" dest="$3"
  local chain jump
  chain="$(chain_of "$family" | sed -n '1p')"
  jump="$(chain_of "$family" | sed -n '2p')"
  if ! grep -q "^-A ${jump} .* -j ${chain}$" "$rendered"; then
    echo "Falta el salto -j ${chain} en ${jump}." >&2
    return 1
  fi
  {
    echo "*filter"
    grep "^:${chain} " "$rendered" || true
    echo ":${jump} - [0:0]"
    grep "^-A ${chain} " "$rendered" || true
    grep "^-A ${jump} .* -j ${chain}$" "$rendered"
    echo "COMMIT"
  } > "$dest"
}

restore_ok() {
  local family="$1" snippet="$2"
  local legacy nft
  if [[ "$family" == "v6" ]]; then
    legacy="ip6tables-legacy-restore"
    nft="ip6tables-restore"
  else
    legacy="iptables-legacy-restore"
    nft="iptables-restore"
  fi
  if command -v "$legacy" >/dev/null 2>&1; then
    "$legacy" --test < "$snippet"
    return
  fi
  if command -v unshare >/dev/null 2>&1 && command -v "$nft" >/dev/null 2>&1; then
    unshare -n "$nft" < "$snippet"
    return
  fi
  echo "No hay ${legacy} ni un namespace para comprobar ${family}." >&2
  return 1
}

if ! own_chains_ok "$work/before.rules" || ! own_chains_ok "$work/before6.rules"; then
  echo "La cadena IABOT no está declarada en la misma tabla. No se toca ufw." >&2
  exit 1
fi
if ! snippet_for v4 "$work/before.rules" "$work/v4.snippet"; then
  echo "before.rules no tiene el salto a IABOT-EGRESS. No se toca ufw." >&2
  exit 1
fi
if ! snippet_for v6 "$work/before6.rules" "$work/v6.snippet"; then
  echo "before6.rules no tiene el salto a IABOT-EGRESS6. No se toca ufw." >&2
  exit 1
fi
if ! restore_ok v4 "$work/v4.snippet"; then
  echo "El restore rechazó before.rules. No se toca ufw." >&2
  exit 1
fi
if ! restore_ok v6 "$work/v6.snippet"; then
  echo "El restore rechazó before6.rules. No se toca ufw." >&2
  exit 1
fi

cp "$work/before.rules" "$v4"
cp "$work/before6.rules" "$v6"
