import { createHash, timingSafeEqual } from "node:crypto";
import { parseAction } from "./actions.ts";
import type { Desktop } from "./desktop.ts";
import { runComputerTask } from "./loop.ts";
import { createMockModel } from "./mock.ts";
import { computerModelName, createLiveComputerModel, resolveXaiMode } from "./xai.ts";

export type AgentEnv = {
  XAI_MODE?: string;
  XAI_API_KEY?: string;
  XAI_API_URL?: string;
  XAI_COMPUTER_MODEL?: string;
  AGENT_RUNTIME_TOKEN?: string;
  DISPLAY?: string;
  CHROME_PROFILE?: string;
};

export type AgentRequest = {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string | undefined>;
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
    if (key.toLowerCase() === wanted) return value ?? "";
  }
  return "";
}

function authorized(headers: AgentRequest["headers"], expected: string) {
  if (!expected) return true;
  const raw = header(headers, "authorization");
  const got = raw.startsWith("Bearer ") ? raw.slice("Bearer ".length) : "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handleAgent(request: AgentRequest, deps: AgentDeps): Promise<AgentResponse> {
  const method = request.method.toUpperCase();
  const path = request.path;
  if (!authorized(request.headers, (deps.env.AGENT_RUNTIME_TOKEN ?? "").trim())) {
    return json(401, { ok: false, error: "token" });
  }

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

  if (method === "POST" && (path === "/action" || path === "/task")) {
    if (request.body === null || request.body === undefined || typeof request.body !== "object") {
      return json(400, { ok: false, error: "datos" });
    }
  }

  if (method === "POST" && path === "/action") {
    const parsed = parseAction(request.body);
    if (!parsed.ok) return json(400, { ok: false, error: parsed.error });
    try {
      await deps.desktop.perform(parsed.action);
    } catch {
      return json(503, { ok: false, error: "escritorio" });
    }
    return json(200, { ok: true });
  }

  if (method === "POST" && path === "/task") {
    const record = request.body as { goal?: unknown; model?: unknown };
    const goal = typeof record.goal === "string" ? record.goal.trim() : "";
    if (!goal || goal.length > 2000) return json(400, { ok: false, error: "Escribe un objetivo de hasta 2000 caracteres." });
    const mode = resolveXaiMode(deps.env);
    const modelName = computerModelName(typeof record.model === "string" ? record.model : deps.env.XAI_COMPUTER_MODEL);
    const model =
      mode === "mock"
        ? createMockModel()
        : createLiveComputerModel({
            apiKey: (deps.env.XAI_API_KEY ?? "").trim(),
            baseUrl: (deps.env.XAI_API_URL ?? "https://api.x.ai/v1").trim() || "https://api.x.ai/v1",
            model: modelName,
            fetchImpl: deps.fetchImpl,
          });
    const result = await runComputerTask({ goal, desktop: deps.desktop, model });
    console.log(JSON.stringify({ evento: "tarea", status: result.status, pasos: result.steps.length, modo: mode }));
    return json(200, { ok: result.status === "DONE", ...result, xaiMode: mode, model: modelName });
  }

  return json(404, { ok: false, error: "ruta" });
}
