import { createServer } from "node:http";
import { createCdpDesktop, ensureWhatsappTab, waitForCdp } from "./cdp.ts";
import { handleAgent } from "./http.ts";
import { resolveXaiMode } from "./xai.ts";

const port = Number(process.env.AGENT_PORT || 8787);
const bind = process.env.AGENT_BIND?.trim() || "127.0.0.1";
const cdpBase = process.env.CDP_URL?.trim() || "http://127.0.0.1:9222";
const profileDir = process.env.CHROME_PROFILE?.trim() || "/data/chrome-profile";
const display = process.env.DISPLAY?.trim() || ":99";
const desktop = createCdpDesktop({ cdpBase, display, profileDir });

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) {
      res.writeHead(413, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "datos" }));
      return;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks);
  let body: unknown;
  if (raw.length) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = null;
    }
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  try {
    const result = await handleAgent(
      { method: req.method || "GET", path: url.pathname, body, headers },
      { env: process.env, desktop },
    );
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "interno" }));
  }
});

server.listen(port, bind, () => {
  console.log(JSON.stringify({ evento: "escucha", port, bind, modo: resolveXaiMode(process.env) }));
  void openWhatsapp();
});

async function openWhatsapp() {
  const ready = await waitForCdp(cdpBase);
  if (!ready) {
    console.log(JSON.stringify({ evento: "chromium", ok: false }));
    return;
  }
  try {
    const opened = await ensureWhatsappTab(cdpBase);
    console.log(JSON.stringify({ evento: "whatsapp_tab", abierto: opened }));
  } catch {
    console.log(JSON.stringify({ evento: "whatsapp_tab", ok: false }));
  }
}
