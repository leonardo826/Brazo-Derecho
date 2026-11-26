import { randomBytes } from "node:crypto";
import { authorizeRuntimeAction, parseAction } from "./actions.ts";
import { handshakeProof, normalizeHost, requestSignature, signaturesMatch } from "./sign.ts";
import { sanitizeCredentialMeta } from "./credentials.ts";
import type { Desktop } from "./desktop.ts";
import { runComputerTask, type FillMaterial } from "./loop.ts";
import { createMockModel } from "./mock.ts";
import { computerModelName, createLiveComputerModel, resolveXaiMode } from "./xai.ts";

export type AgentEnv = {
  XAI_MODE?: string;
  XAI_API_KEY?: string;
  XAI_API_URL?: string;
  XAI_COMPUTER_MODEL?: string;
  AGENT_RUNTIME_TOKEN?: string;
  AGENT_RUNTIME_TOKEN_PREVIOUS?: string;
  MACHINE_ID?: string;
  MACHINE_AGENT_DOMAIN?: string;
  LEASE_EPOCH?: string;
  VAULT_FILL_URL?: string;
  DISPLAY?: string;
  CHROME_PROFILE?: string;
};

export type AgentRequest = {
  method: string;
  path: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export type AgentResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export type AgentDeps = {
  env: AgentEnv;
  desktop: Desktop;
  fetchImpl?: typeof fetch;
};

function json(status: number, body: unknown): AgentResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: Buffer.from(JSON.stringify(body)),
  };
}

function header(headers: AgentRequest["headers"], name: string) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return "";
}

const seenNonces = new Map<string, number>();

function runtimeTokens(env: AgentEnv) {
  return [env.AGENT_RUNTIME_TOKEN, env.AGENT_RUNTIME_TOKEN_PREVIOUS].map((item) => (item ?? "").trim()).filter((item) => item.length > 0);
}

function signedToken(request: AgentRequest, env: AgentEnv) {
  const domain = normalizeHost(env.MACHINE_AGENT_DOMAIN ?? "");
  if (!domain) return null;
  const timestamp = header(request.headers, "x-iabot-timestamp");
  const nonce = header(request.headers, "x-iabot-nonce");
  const host = normalizeHost(header(request.headers, "x-iabot-host"));
  const signature = header(request.headers, "x-iabot-signature");
  if (!/^[0-9]{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,80}$/.test(nonce) || !signature) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 || host !== domain || seenNonces.has(nonce)) return null;
  const body = request.rawBody ?? "";
  const matched = runtimeTokens(env).find((token) =>
    signaturesMatch(requestSignature(token, { timestamp, nonce, method: request.method, path: request.path, body, host }), signature),
  );
  if (!matched) return null;
  seenNonces.set(nonce, now);
  return matched;
}

type Inflight = { controller: AbortController };
const inflight = new Map<string, Inflight>();
const cancelledEarly = new Set<string>();

export function resetAgentTasks() {
  for (const job of inflight.values()) job.controller.abort();
  inflight.clear();
  cancelledEarly.clear();
}

function rememberCancel(taskId: string) {
  cancelledEarly.add(taskId);
  while (cancelledEarly.size > 64) {
    const first = cancelledEarly.values().next().value;
    if (!first) break;
    cancelledEarly.delete(first);
  }
}

function taskIdOf(body: unknown) {
  const value = body && typeof body === "object" ? (body as { taskId?: unknown }).taskId : "";
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : "";
}

function epochAccepted(body: unknown, env: AgentEnv) {
  const expected = (env.LEASE_EPOCH ?? "").trim();
  if (!expected) return true;
  const value = body && typeof body === "object" ? (body as { epoch?: unknown }).epoch : undefined;
  return typeof value === "number" && Number.isInteger(value) && String(value) === expected;
}

function handshake(request: AgentRequest, deps: AgentDeps, signer: string): AgentResponse {
  const machineId = (deps.env.MACHINE_ID ?? "").trim();
  const record = request.body && typeof request.body === "object" ? (request.body as { nonce?: unknown; machineId?: unknown; host?: unknown }) : {};
  const nonce = typeof record.nonce === "string" ? record.nonce : "";
  const claimed = typeof record.machineId === "string" ? record.machineId : "";
  const host = normalizeHost(typeof record.host === "string" ? record.host : "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) return json(400, { ok: false, error: "datos" });
  if (!machineId || claimed !== machineId || host !== normalizeHost(deps.env.MACHINE_AGENT_DOMAIN ?? "")) {
    return json(403, { ok: false, error: "maquina" });
  }
  return json(200, { machineId, nonce, host, proof: handshakeProof(signer, nonce, machineId, host) });
}

export async function handleAgent(request: AgentRequest, deps: AgentDeps): Promise<AgentResponse> {
  const method = request.method.toUpperCase();
  const path = request.path;
  const signer = signedToken({ ...request, method, path }, deps.env);
  if (!signer) return json(401, { ok: false, error: "token" });
  if (method === "POST" && path === "/handshake") return handshake(request, deps, signer);
  const runtimeToken = signer;

  if (method === "GET" && path === "/status") {
    const status = await deps.desktop.status();
    const mode = resolveXaiMode(deps.env);
    return json(200, {
      ok: status.ok,
      servicio: "iabot-desktop",
      display: status.display,
      chromium: status.chromium,
      whatsappTab: status.whatsappTab,
      profileDir: status.profileDir,
      xaiMode: mode,
      model: computerModelName(deps.env.XAI_COMPUTER_MODEL),
      machineId: (deps.env.MACHINE_ID ?? "").trim(),
    });
  }

  if (method === "GET" && path === "/screenshot") {
    try {
      const png = await deps.desktop.screenshot();
      return { status: 200, headers: { "content-type": "image/png", "cache-control": "no-store" }, body: png };
    } catch {
      return json(503, { ok: false, error: "escritorio" });
    }
  }

  if (method === "POST" && (path === "/action" || path === "/task" || path === "/task/cancel")) {
    if (request.body === null || request.body === undefined || typeof request.body !== "object") {
      return json(400, { ok: false, error: "datos" });
    }
  }

  const machineId = (deps.env.MACHINE_ID ?? "").trim();
  function boundMachine(body: unknown) {
    const claimed = body && typeof body === "object" ? (body as { machineId?: unknown }).machineId : "";
    return Boolean(machineId) && typeof claimed === "string" && claimed === machineId;
  }

  if (method === "POST" && path === "/action") {
    if (!boundMachine(request.body)) return json(403, { ok: false, error: "maquina" });
    if (!epochAccepted(request.body, deps.env)) return json(409, { ok: false, error: "epoca" });
    const taskId = taskIdOf(request.body);
    const job = taskId ? inflight.get(taskId) : undefined;
    if (!job || job.controller.signal.aborted) return json(403, { ok: false, error: "tarea" });
    const parsed = parseAction(request.body);
    if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
    const authz = authorizeRuntimeAction(parsed.action, { allowFill: false, aborted: job.controller.signal.aborted });
    if (!authz.ok || parsed.action.type === "fill") {
      return json(403, { ok: false, error: "El relleno de una clave no entra por esta ruta." });
    }
    try {
      await deps.desktop.perform(parsed.action);
    } catch {
      return json(503, { ok: false, error: "escritorio" });
    }
    return json(200, { ok: true });
  }

  if (method === "POST" && path === "/task/cancel") {
    if (!boundMachine(request.body)) return json(403, { ok: false, error: "maquina" });
    if (!epochAccepted(request.body, deps.env)) return json(409, { ok: false, error: "epoca" });
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

  if (method === "POST" && path === "/task") {
    if (!boundMachine(request.body)) return json(403, { ok: false, error: "maquina" });
    if (!epochAccepted(request.body, deps.env)) return json(409, { ok: false, error: "epoca" });
    const record = request.body as { goal?: unknown; model?: unknown; credentials?: unknown; fillGrant?: unknown };
    const goal = typeof record.goal === "string" ? record.goal.trim() : "";
    if (!goal || goal.length > 2000) return json(400, { ok: false, error: "Escribe un objetivo de hasta 2000 caracteres." });
    const taskId = taskIdOf(request.body) || `local_${randomBytes(9).toString("hex")}`;
    const mode = resolveXaiMode(deps.env);
    const modelName = computerModelName(typeof record.model === "string" ? record.model : deps.env.XAI_COMPUTER_MODEL);
    if (cancelledEarly.has(taskId)) {
      cancelledEarly.delete(taskId);
      return json(200, { ok: false, status: "FAILED", result: "Cancelada. No hay resultado.", steps: [], xaiMode: mode, model: modelName });
    }
    if (inflight.has(taskId)) return json(409, { ok: false, error: "tarea" });
    const credentials = sanitizeCredentialMeta(record.credentials);
    const fillGrant = typeof record.fillGrant === "string" ? record.fillGrant : "";
    const controller = new AbortController();
    inflight.set(taskId, { controller });
    const model =
      mode === "mock"
        ? createMockModel()
        : createLiveComputerModel({
            apiKey: (deps.env.XAI_API_KEY ?? "").trim(),
            baseUrl: (deps.env.XAI_API_URL ?? "https://api.x.ai/v1").trim() || "https://api.x.ai/v1",
            model: modelName,
            fetchImpl: deps.fetchImpl,
          });
    const fillLogin = fillGrant ? (credentialId: string) => fillFromVault(deps, fillGrant, credentialId) : undefined;
    try {
      // clientConfirmed no se acepta en el cuerpo: declarar y pagar siguen bloqueados en esta ruta.
      const result = await runComputerTask({
        goal,
        desktop: deps.desktop,
        model,
        credentials,
        fillLogin,
        allowFill: Boolean(fillGrant),
        signal: controller.signal,
        redactSecrets: runtimeToken ? [runtimeToken] : [],
      });
      console.log(JSON.stringify({ evento: "tarea", status: result.status, pasos: result.steps.length, modo: mode }));
      if (controller.signal.aborted) {
        return json(200, { ok: false, status: "FAILED", result: "Cancelada. No hay resultado.", steps: result.steps, xaiMode: mode, model: modelName });
      }
      return json(200, { ok: result.status === "DONE", ...result, xaiMode: mode, model: modelName });
    } finally {
      if (inflight.get(taskId)?.controller === controller) inflight.delete(taskId);
    }
  }

  return json(404, { ok: false, error: "ruta" });
}

async function fillFromVault(deps: AgentDeps, grant: string, credentialId: string): Promise<FillMaterial | null> {
  const url = (deps.env.VAULT_FILL_URL ?? "").trim();
  const token = (deps.env.AGENT_RUNTIME_TOKEN ?? "").trim();
  if (!url || !grant || !token) return null;
  const response = await (deps.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ grant, credentialId }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as { ok?: unknown; username?: unknown; secret?: unknown } | null;
  if (!response.ok || !data || data.ok !== true || typeof data.username !== "string" || typeof data.secret !== "string") {
    return null;
  }
  return { username: data.username, secret: data.secret };
}
