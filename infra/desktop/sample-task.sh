#!/bin/bash
# Tarea de prueba contra el agente local. Sin token o sin máquina no llama.
set -euo pipefail
BASE="${AGENT_URL:-http://127.0.0.1:8787}"
TOKEN="${AGENT_RUNTIME_TOKEN:-}"
MACHINE="${MACHINE_ID:-}"
GOAL="${1:-Abre https://example.com y dime el título}"
if [ -z "$TOKEN" ] || [ -z "$MACHINE" ]; then
  echo "Faltan AGENT_RUNTIME_TOKEN y MACHINE_ID. No se llama al agente." >&2
  exit 1
fi
curl -sS -X POST "$BASE/task" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({ goal: process.argv[1], machineId: process.argv[2] }))' "$GOAL" "$MACHINE")"
echo
