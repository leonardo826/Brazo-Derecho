#!/usr/bin/env bash
# Decide si ufw debe recargarse o encenderse, y comprueba que el salto quedó cargado.
ufw_load_action() {
  if printf '%s\n' "$1" | grep -Eq '^Status:[[:space:]]+active([[:space:]]|$)'; then
    printf 'reload\n'
  else
    printf 'enable\n'
  fi
}

run_ufw_load() {
  local ufw="${UFW_BIN:-ufw}"
  local ipt="${IPTABLES_BIN:-iptables}"
  local ip6="${IP6TABLES_BIN:-ip6tables}"
  local status action v4 v6
  status="$("$ufw" status)" || return 1
  action="$(ufw_load_action "$status")"
  if [[ "$action" == "reload" ]]; then
    "$ufw" reload || return 1
  else
    "$ufw" --force enable || return 1
  fi
  v4="$("$ipt" -S ufw-before-output 2>/dev/null || true)"
  v6="$("$ip6" -S ufw6-before-output 2>/dev/null || true)"
  printf '%s\n' "$v4" | grep -Eq -- '-j IABOT-EGRESS( |$)' || return 1
  printf '%s\n' "$v6" | grep -Fq -- '-j IABOT-EGRESS6' || return 1
  return 0
}

rollback_ufw_files() {
  local bak="$1"
  local ufw="${UFW_BIN:-ufw}"
  local dir="${UFW_RULES_DIR:-/etc/ufw}"
  cp -a "$bak/before.rules" "$dir/before.rules"
  cp -a "$bak/before6.rules" "$dir/before6.rules"
  "$ufw" reload
}
