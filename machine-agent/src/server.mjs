import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { pathToFileURL } from "node:url";
import { browsePublic, navigationAllowed } from "./browser.mjs";
import { handshakeProof } from "./protocol.mjs";

const inflight = new Map();
const cancelledEarly = new Set();

function json(status, body) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: Buffer.from(JSON.stringify(body)),
  };
}

function header(headers, name) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? value[0] ?? "" : value ?? "";
  }
  return "";
}

function authorized(headers, expected) {
  if (!expected) return false;
  const raw = header(headers, "authorization");
  const got = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : "";
  const left = createHash("sha256").update(got).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function taskIdOf(body) {
  const value = body && typeof body === "object" ? body.taskId : "";
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : "";
}

function rememberCancel(taskId) {
  cancelledEarly.add(taskId);
  while (cancelledEarly.size > 64) {
    const first = cancelledEarly.values().next().value;
    if (!first) break;
    cancelledEarly.delete(first);
  }
}

export function resetMachineTasks() {
  for (const job of inflight.values()) job.controller.abort();
  inflight.clear();
  cancelledEarly.clear();
}

function epochOk(body, leaseEpoch) {
  const expected = String(leaseEpoch ?? "").trim();
  if (!expected) return false;
  const value = body && typeof body === "object" ? body.epoch : undefined;
  return typeof value === "number" && Number.isInteger(value) && String(value) === expected;
}

export async function handleMachine(request, deps) {
  const method = String(request.method || "GET").toUpperCase();
  const path = request.path || "/";
  const token = String(deps.token || "").trim();
  const machineId = String(deps.machineId || "").trim();
  if (method === "POST" && path === "/handshake") {
    const record = request.body && typeof request.body === "object" ? request.body : {};
    const nonce = typeof record.nonce === "string" ? record.nonce : "";
    const claimed = typeof record.machineId === "string" ? record.machineId : "";
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) return json(400, { ok: false, error: "datos" });
    if (!token || !machineId || claimed !== machineId) return json(403, { ok: false, error: "maquina" });
    return json(200, { machineId, nonce, proof: handshakeProof(token, nonce, machineId) });
  }
  if (!authorized(request.headers, token)) return json(401, { ok: false, error: "token" });
  const claimedMachine = request.body && typeof request.body === "object" ? request.body.machineId : "";
  const bound = Boolean(machineId) && claimedMachine === machineId;

  if (method === "GET" && path === "/status") {
    return json(200, { machineId, servicio: "iabot-machine-agent" });
  }

  if (method === "POST" && path === "/task/cancel") {
    if (!bound) return json(403, { ok: false, error: "maquina" });
    if (!epochOk(request.body, deps.leaseEpoch)) return json(409, { ok: false, error: "epoca" });
    const taskId = taskIdOf(request.body);
    const ids = taskId ? [taskId] : [...inflight.keys()];
    for (const id of ids) {
      const job = inflight.get(id);
      job?.controller.abort();
      if (job) inflight.delete(id);
      if (taskId) rememberCancel(id);
    }
    return json(200, { ok: true, status: "FAILED", result: "Cancelada. No hay resultado." });
  }

  if (method === "POST" && path === "/action") {
    if (!bound) return json(403, { ok: false, error: "maquina" });
    const taskId = taskIdOf(request.body);
    const job = taskId ? inflight.get(taskId) : undefined;
    if (!job || job.controller.signal.aborted) return json(403, { ok: false, error: "tarea" });
    const action = request.body;
    if (!action || action.type === "fill") return json(403, { ok: false, error: "accion" });
    if (action.type === "goto") {
      const url = await (deps.allow ?? navigationAllowed)(String(action.url ?? ""), deps.lookup);
      if (!url) return json(400, { ok: false, error: "destino" });
      if (deps.perform) await deps.perform({ type: "goto", url }, job.controller.signal);
      return json(200, { ok: true });
    }
    if (action.type === "click" || action.type === "type" || action.type === "key" || action.type === "scroll") {
      if (deps.perform) await deps.perform(action, job.controller.signal);
      return json(200, { ok: true });
    }
    return json(400, { ok: false, error: "accion" });
  }

  if (method === "POST" && path === "/task") {
    if (!bound) return json(403, { ok: false, error: "maquina" });
    if (!epochOk(request.body, deps.leaseEpoch)) return json(409, { ok: false, error: "epoca" });
    const goal = typeof request.body?.goal === "string" ? request.body.goal.trim() : "";
    if (!goal || goal.length > 2000) return json(400, { ok: false, error: "datos" });
    const taskId = taskIdOf(request.body) || `local_${Date.now().toString(36)}`;
    if (cancelledEarly.has(taskId)) {
      cancelledEarly.delete(taskId);
      return json(200, { ok: false, status: "FAILED", result: "Cancelada. No hay resultado.", steps: [], xaiMode: "live" });
    }
    if (inflight.has(taskId)) return json(409, { ok: false, error: "tarea" });
    const controller = new AbortController();
    inflight.set(taskId, { controller });
    try {
      const url = await (deps.allow ?? navigationAllowed)(goal, deps.lookup);
      if (!url) {
        return json(200, {
          ok: false,
          status: "FAILED",
          result: "No hay una página pública en el pedido.",
          steps: [],
          xaiMode: "live",
        });
      }
      const browse = deps.browse ?? browsePublic;
      const page = await browse(url, controller.signal, deps.lookup);
      if (controller.signal.aborted) {
        return json(200, { ok: false, status: "FAILED", result: "Cancelada. No hay resultado.", steps: [], xaiMode: "live" });
      }
      const hostname = new URL(url).hostname;
      const title = String(page?.title ?? "").replaceAll(token, "[redactado]").slice(0, 300);
      return json(200, {
        ok: true,
        status: "DONE",
        xaiMode: "live",
        result: `${title} ${hostname}`.slice(0, 2000),
        steps: [{ kind: "action", action: { type: "goto", url } }],
      });
    } catch {
      const cancelled = controller.signal.aborted;
      return json(200, {
        ok: false,
        status: "FAILED",
        result: cancelled ? "Cancelada. No hay resultado." : "No pude abrir la página.",
        steps: [],
        xaiMode: "live",
      });
    } finally {
      if (inflight.get(taskId)?.controller === controller) inflight.delete(taskId);
    }
  }

  return json(404, { ok: false, error: "ruta" });
}

export function listen(env = process.env) {
  const token = (env.AGENT_RUNTIME_TOKEN ?? "").trim();
  const machineId = (env.MACHINE_ID ?? "").trim();
  const leaseEpoch = (env.LEASE_EPOCH ?? "").trim();
  const port = Number(env.PORT || 8787);
  const bind = (env.BIND || "127.0.0.1").trim();
  if (!token || !machineId || !leaseEpoch) {
    process.stderr.write("faltan AGENT_RUNTIME_TOKEN, MACHINE_ID o LEASE_EPOCH\n");
    process.exit(1);
  }
  const certFile = (env.TLS_CERT_FILE ?? "").trim();
  const keyFile = (env.TLS_KEY_FILE ?? "").trim();
  const loopback = bind === "127.0.0.1" || bind === "::1";
  if (!loopback && (!certFile || !keyFile)) {
    process.stderr.write("un bind público exige TLS_CERT_FILE y TLS_KEY_FILE\n");
    process.exit(1);
  }
  const deps = { token, machineId, leaseEpoch };
  const onRequest = async (req, res) => {
    const chunks = [];
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
    let body;
    if (raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        body = null;
      }
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
      const result = await handleMachine(
        { method: req.method, path: url.pathname, body, headers: req.headers },
        deps,
      );
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "interno" }));
    }
  };
  const server = certFile && keyFile
    ? createHttps({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, onRequest)
    : createHttp(onRequest);
  server.listen(port, bind, () => {
    process.stdout.write(`${JSON.stringify({ evento: "escucha", port, bind, tls: Boolean(certFile) })}\n`);
  });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) listen();
