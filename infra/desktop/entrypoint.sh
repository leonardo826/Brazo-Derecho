#!/bin/bash
# Parte el escritorio virtual, Chromium con perfil persistente y el agente.
# WhatsApp Web lo abre el agente en otra pestaña del mismo perfil. El QR lo escanea una persona.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export CHROME_PROFILE="${CHROME_PROFILE:-/data/chrome-profile}"
WIDTH="${SCREEN_WIDTH:-1280}"
HEIGHT="${SCREEN_HEIGHT:-800}"

mkdir -p "$CHROME_PROFILE"
chmod 700 "$CHROME_PROFILE" || true

CHROME_BIN="$(command -v chromium || command -v chromium-browser || true)"
if [[ -z "$CHROME_BIN" ]]; then
  echo "Falta Chromium en la imagen." >&2
  exit 1
fi

Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &

for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -localhost -nopw -noxdamage >/tmp/x11vnc.log 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

"$CHROME_BIN" \
  --user-data-dir="$CHROME_PROFILE" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --disable-translate \
  --disable-sync \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position=0,0 \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --lang=es-CL \
  about:blank >/tmp/chromium.log 2>&1 &

for _ in $(seq 1 50); do
  if curl -sf http://127.0.0.1:9222/json/version >/dev/null; then
    break
  fi
  sleep 0.2
done

exec node --experimental-strip-types /opt/agent-runtime/src/server.ts
