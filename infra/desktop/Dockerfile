# Escritorio local de IA Bot: Xvfb + fluxbox + Chromium + noVNC + agente.
# No despliega a Fly. El perfil de Chromium vive en /data/chrome-profile.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    DISPLAY=:99 \
    CHROME_PROFILE=/data/chrome-profile \
    AGENT_PORT=8787 \
    AGENT_BIND=0.0.0.0 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    XAI_MODE=mock

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      chromium \
      curl \
      fluxbox \
      fonts-liberation \
      fonts-noto-color-emoji \
      novnc \
      procps \
      websockify \
      tini \
      x11-utils \
      x11vnc \
      xdotool \
      xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/agent-runtime
COPY agent-runtime/package.json agent-runtime/package-lock.json ./
RUN npm ci --omit=dev
COPY agent-runtime/ ./
COPY infra/desktop/entrypoint.sh /opt/desktop/entrypoint.sh
RUN chmod +x /opt/desktop/entrypoint.sh

EXPOSE 6080 8787
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/desktop/entrypoint.sh"]
