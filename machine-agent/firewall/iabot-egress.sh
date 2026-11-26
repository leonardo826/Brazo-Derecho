#!/usr/bin/env bash
# Cadena propia al frente de OUTPUT, y el mismo bloque en ufw before.rules.
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

v4_rules() {
  if [[ -n "$resolver" ]]; then
    echo "-A IABOT-EGRESS -p udp -d ${resolver} --dport 53 -j RETURN"
  fi
  echo "-A IABOT-EGRESS -p udp -j REJECT"
  for spec in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 192.88.99.0/24 0.0.0.0/8; do
    echo "-A IABOT-EGRESS -d ${spec} -j REJECT"
  done
  echo "-A IABOT-EGRESS -d 127.0.0.0/8 -p tcp --dport 8787 -j REJECT"
  echo "-A IABOT-EGRESS -j RETURN"
}

v6_rules() {
  if [[ -n "$resolver6" ]]; then
    echo "-A IABOT-EGRESS6 -p udp -d ${resolver6} --dport 53 -j RETURN"
  fi
  echo "-A IABOT-EGRESS6 -p udp -j REJECT"
  for spec in fe80::/10 fc00::/7 2001:db8::/32 2001::/32 64:ff9b:1::/48; do
    echo "-A IABOT-EGRESS6 -d ${spec} -j REJECT"
  done
  echo "-A IABOT-EGRESS6 -d ::1 -p tcp --dport 8787 -j REJECT"
  echo "-A IABOT-EGRESS6 -j RETURN"
}

apply_live() {
  iptables -N IABOT-EGRESS 2>/dev/null || iptables -F IABOT-EGRESS
  while read -r rule; do
    # shellcheck disable=SC2086
    iptables $rule
  done < <(v4_rules)
  if ! iptables -C OUTPUT -m owner --uid-owner "$uid" -j IABOT-EGRESS >/dev/null 2>&1; then
    iptables -I OUTPUT 1 -m owner --uid-owner "$uid" -j IABOT-EGRESS
  fi
  ip6tables -N IABOT-EGRESS6 2>/dev/null || ip6tables -F IABOT-EGRESS6
  while read -r rule; do
    # shellcheck disable=SC2086
    ip6tables $rule
  done < <(v6_rules)
  if ! ip6tables -C OUTPUT -m owner --uid-owner "$uid" -j IABOT-EGRESS6 >/dev/null 2>&1; then
    ip6tables -I OUTPUT 1 -m owner --uid-owner "$uid" -j IABOT-EGRESS6
  fi
}

persist_ufw() {
  local file="$1"
  local chain="$2"
  local rules="$3"
  local jump="$4"
  [[ -f "$file" ]] || return 0
  local block
  block="$(printf '%s\n' ":${chain} - [0:0]" "$rules" "$jump")"
  python3 - "$file" "$block" <<'PY'
import pathlib, sys
path, block = sys.argv[1], sys.argv[2]
text = pathlib.Path(path).read_text()
begin = "# IABOT-EGRESS-BEGIN\n"
end = "# IABOT-EGRESS-END\n"
chunk = begin + block + "\n" + end
if begin in text and end in text:
    pre, rest = text.split(begin, 1)
    _old, post = rest.split(end, 1)
    text = pre + chunk + post
else:
    needle = "\nCOMMIT\n"
    idx = text.rfind(needle)
    insert = "\n" + chunk + "\n"
    text = text + insert if idx < 0 else text[:idx] + insert + text[idx:]
pathlib.Path(path).write_text(text)
PY
}

apply_live
persist_ufw /etc/ufw/before.rules IABOT-EGRESS "$(v4_rules)" "-A ufw-before-output -m owner --uid-owner ${uid} -j IABOT-EGRESS"
persist_ufw /etc/ufw/before6.rules IABOT-EGRESS6 "$(v6_rules)" "-A ufw-before-output -m owner --uid-owner ${uid} -j IABOT-EGRESS6"
