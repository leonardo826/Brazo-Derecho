#!/bin/bash
# Tarea de prueba contra el agente local, sin clave de xAI.
set -euo pipefail
BASE="${AGENT_URL:-http://127.0.0.1:8787}"
GOAL="${1:-Abre https://example.com y dime el título}"
curl -sS -X POST "$BASE/task" \
  -H "content-type: application/json" \
  -d "$(node -e 'process.stdout.write(JSON.stringify({ goal: process.argv[1] }))' "$GOAL")"
echo
