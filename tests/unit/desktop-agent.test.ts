import { describe, expect, test, vi } from "vitest";
import { parseAction, parseHttpUrl, xdotoolArgs, type DesktopAction } from "../../agent-runtime/src/actions";
import { pagesFromList, pngFromCdpResult, ensureWhatsappTab } from "../../agent-runtime/src/cdp";
import type { Desktop } from "../../agent-runtime/src/desktop";
import { pickWorkWindow } from "../../agent-runtime/src/desktop";
import { handleAgent, nonceStillSeen, rememberSeenNonce, resetAgentTasks } from "../../agent-runtime/src/http";
import { readAgentHttp } from "../../agent-runtime/src/request";
import { signRequest } from "@/lib/computer/request-sign";
import { mockUrlForGoal } from "../../agent-runtime/src/mock";
import { runComputerTask } from "../../agent-runtime/src/loop";
import { createMockModel } from "../../agent-runtime/src/mock";
import { sanitizeCredentialMeta } from "../../agent-runtime/src/credentials";
import type { ComputerModel } from "../../agent-runtime/src/desktop";
import { isBulkGoal, isHighRiskGoal, isSensitiveGoal } from "../../agent-runtime/src/sensitive";
import { buildComputerRequest, createLiveComputerModel, resolveXaiMode } from "../../agent-runtime/src/xai";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const AGENT_TOKEN = "agent-token";
const MACHINE_ID = "machine-1";
const DOMAIN = "machine.test";

function agentEnv(extra: Record<string, string> = {}) {
  return { AGENT_RUNTIME_TOKEN: AGENT_TOKEN, MACHINE_ID, MACHINE_AGENT_DOMAIN: DOMAIN, LEASE_EPOCH: "1", ...extra };
}

function agentTask(body: Record<string, unknown>, path = "/task") {
  const payload = { machineId: MACHINE_ID, epoch: 1, ...body };
  const rawBody = JSON.stringify(payload);
  return {
    method: "POST",
    path,
    body: payload,
    rawBody,
    headers: { "content-type": "application/json", ...signRequest({ token: AGENT_TOKEN, method: "POST", path, body: rawBody, host: DOMAIN }) },
  };
}

function fakeDesktop() {
  const actions: DesktopAction[] = [];
  let shots = 0;
  const desktop: Desktop = {
    async screenshot() {
      shots += 1;
      return PNG;
    },
    async perform(action) {
      actions.push(action);
    },
    async status() {
      return { ok: true, display: ":99", chromium: "up", whatsappTab: true, profileDir: "/data/chrome-profile" };
    },
  };
  return { desktop, actions, shots: () => shots };
}

describe("agente de computador en simulador", () => {
  test("el loop mock abre example.com y toma una captura, sin red", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    const rig = fakeDesktop();
    const result = await runComputerTask({
      goal: "Abre https://example.com y dime el título",
      desktop: rig.desktop,
      model: createMockModel(),
    });
    expect(result.status).toBe("DONE");
    expect(result.result).toMatch(/Simulador/);
    expect(result.result).toMatch(/example\.com/);
    expect(rig.shots()).toBeGreaterThan(0);
    expect(rig.actions).toContainEqual({ type: "goto", url: "https://example.com/" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("POST /task en modo mock hace goto y screenshot", async () => {
    const rig = fakeDesktop();
    const fetchMock = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    const response = await handleAgent(
      agentTask({ goal: "Abre https://example.com y dime el título" }),
      { env: agentEnv({ XAI_MODE: "mock", XAI_API_KEY: "no-usar" }), desktop: rig.desktop, fetchImpl: fetchMock as typeof fetch },
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body.toString("utf8")) as { status: string; xaiMode: string };
    expect(body.status).toBe("DONE");
    expect(body.xaiMode).toBe("mock");
    expect(rig.actions).toContainEqual({ type: "goto", url: "https://example.com/" });
    expect(rig.shots()).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Wikipedia sin URL igual navega", () => {
    expect(mockUrlForGoal("Busca Chile en Wikipedia")).toBe("https://es.wikipedia.org/w/index.php?search=Chile");
  });

  test("enviar o pagar no toca el escritorio", async () => {
    const rig = fakeDesktop();
    const result = await runComputerTask({
      goal: "Envía un mensaje y paga la cuenta",
      desktop: rig.desktop,
      model: createMockModel(),
    });
    expect(result.status).toBe("PENDING_APPROVAL");
    expect(rig.shots()).toBe(0);
    expect(rig.actions).toHaveLength(0);
  });

  test("el envío masivo se rechaza", async () => {
    const rig = fakeDesktop();
    const result = await runComputerTask({
      goal: "Haz un envío masivo a todos los contactos",
      desktop: rig.desktop,
      model: createMockModel(),
    });
    expect(result.status).toBe("REJECTED");
    expect(isBulkGoal("difusión a todos")).toBe(true);
    expect(isSensitiveGoal("Abre https://web.whatsapp.com")).toBe(false);
  });

  test("sin clave el modo live igual queda en mock", () => {
    expect(resolveXaiMode({ XAI_MODE: "live" })).toBe("mock");
    expect(resolveXaiMode({ XAI_MODE: "mock", XAI_API_KEY: "xai-test" })).toBe("mock");
    expect(resolveXaiMode({ XAI_API_KEY: "xai-test" })).toBe("live");
  });

  test("la llamada viva manda la captura y la herramienta, sin guardar la imagen en xAI", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer xai-test");
      seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const step = seen.length;
      const argumentsJson =
        step === 1
          ? JSON.stringify({ action: "goto", url: "https://example.com" })
          : JSON.stringify({ action: "done", result: "Example cargó." });
      return new Response(
        JSON.stringify({
          output: [{ type: "function_call", name: "computer", arguments: argumentsJson }],
        }),
        { status: 200 },
      );
    });
    const rig = fakeDesktop();
    const model = createLiveComputerModel({
      apiKey: "xai-test",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.3",
      fetchImpl: fetchMock as typeof fetch,
    });
    const result = await runComputerTask({ goal: "Abre https://example.com", desktop: rig.desktop, model });
    expect(result.status).toBe("DONE");
    expect(rig.actions[0]).toEqual({ type: "goto", url: "https://example.com/" });
    expect(seen[0]?.model).toBe("grok-4.3");
    expect(seen[0]?.store).toBe(false);
    expect(JSON.stringify(seen[0]?.tools)).toMatch(/computer/);
    expect(JSON.stringify(seen[0]?.input)).toMatch(/data:image\/png;base64,/);
  });

  test("la acción y el xdotool no pasan por un shell", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseAction({ type: "key", key: "ctrl+w" }).ok).toBe(false);
    const parsed = parseAction({ type: "click", x: 10, y: 20 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(xdotoolArgs(parsed.action as Exclude<typeof parsed.action, { type: "goto" | "fill" }>)).toEqual([
      "mousemove",
      "--sync",
      "10",
      "20",
      "click",
      "1",
    ]);
  });

  test("presentar una declaración no toca el escritorio, ni aunque el cuerpo diga que está confirmada", async () => {
    const rig = fakeDesktop();
    const blocked = await runComputerTask({
      goal: "Presenta la declaración de IVA en el SII",
      desktop: rig.desktop,
      model: createMockModel(),
    });
    expect(blocked.status).toBe("PENDING_APPROVAL");
    expect(rig.actions).toHaveLength(0);
    expect(isHighRiskGoal("Presenta la declaración de IVA")).toBe(true);
    expect(isSensitiveGoal("Presenta la declaración de IVA")).toBe(true);
    expect(isHighRiskGoal("Revisa el F29 en el SII")).toBe(false);
    expect(isSensitiveGoal("Entra al SII a revisar ventas")).toBe(false);
    expect(isSensitiveGoal("Entra al SII con mi clave")).toBe(false);

    const response = await handleAgent(
      agentTask({ goal: "Paga la cuenta del proveedor", clientConfirmed: true }),
      { env: agentEnv({ XAI_MODE: "mock" }), desktop: rig.desktop },
    );
    expect(JSON.parse(response.body.toString("utf8")).status).toBe("PENDING_APPROVAL");
    expect(rig.shots()).toBe(0);
  });

  test("con confirmación del servidor la declaración puede avanzar, sin clave en el texto", async () => {
    const rig = fakeDesktop();
    const result = await runComputerTask({
      goal: "Presenta la declaración de IVA",
      desktop: rig.desktop,
      model: createMockModel(),
      clientConfirmed: true,
    });
    expect(result.status).toBe("DONE");
    expect(rig.shots()).toBeGreaterThan(0);
  });

  test("el simulador rellena el SII con la credencial y no muestra la clave", async () => {
    const secret = "ZzVaultSecret99";
    const username = "user-sii-9988";
    const seen: string[] = [];
    const rig = fakeDesktop();
    const model: ComputerModel = createMockModel();
    const wrapped: ComputerModel = {
      async decide(ctx) {
        seen.push(JSON.stringify({ goal: ctx.goal, credentials: ctx.credentials }));
        return model.decide(ctx);
      },
    };
    const result = await runComputerTask({
      goal: "Entra al SII a revisar ventas",
      desktop: rig.desktop,
      model: wrapped,
      credentials: [{ id: "cred12345678", label: "Clave SII", portal: "SII", usernameHint: "9988" }],
      fillLogin: async () => ({ username, secret }),
    });
    expect(result.status).toBe("DONE");
    expect(result.result).toMatch(/Bóveda/);
    expect(result.result).not.toContain(secret);
    expect(result.result).not.toContain(username);
    expect(seen.join("\n")).not.toContain(secret);
    expect(rig.actions).toContainEqual({ type: "type", text: secret });
    expect(JSON.stringify(result.steps)).toContain("cred12345678");
    expect(JSON.stringify(result.steps)).not.toContain(secret);
  });

  test("fill usa la clave en el escritorio y no se la muestra al modelo", async () => {
    const secret = "ZzVaultSecret99";
    const username = "user-sii-9988";
    const seen: string[] = [];
    const rig = fakeDesktop();
    let step = 0;
    const model: ComputerModel = {
      async decide(ctx) {
        seen.push(JSON.stringify({ goal: ctx.goal, history: ctx.history, credentials: ctx.credentials }));
        step += 1;
        if (step === 1) return { kind: "act", action: { type: "fill", credentialId: "cred12345678" } };
        return { kind: "done", result: `Listo ${secret} ${username}` };
      },
    };
    const result = await runComputerTask({
      goal: "Entra al SII con mi clave",
      desktop: rig.desktop,
      model,
      credentials: [{ id: "cred12345678", label: "SII", portal: "SII", usernameHint: "9988" }],
      fillLogin: async () => ({ username, secret }),
    });
    expect(result.status).toBe("DONE");
    expect(result.result).not.toContain(secret);
    expect(result.result).not.toContain(username);
    expect(result.result).toContain("[redactado]");
    expect(JSON.stringify(result.steps)).not.toContain(secret);
    expect(seen.join("\n")).not.toContain(secret);
    expect(seen.join("\n")).not.toContain(username);
    expect(rig.actions).toContainEqual({ type: "type", text: username });
    expect(rig.actions).toContainEqual({ type: "type", text: secret });

    const parsed = parseAction({ type: "fill", credentialId: "cred12345678", text: secret });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(parsed.action)).not.toContain(secret);
    const meta = sanitizeCredentialMeta([{ id: "cred12345678", label: "SII", portal: "SII", usernameHint: "9988", secret }]);
    expect(JSON.stringify(meta)).not.toContain(secret);

    const prompt = buildComputerRequest({
      model: "grok-4.3",
      goal: "Entra al SII",
      screenshot: PNG,
      history: [`fill cred12345678`],
      credentials: meta,
    });
    expect(JSON.stringify(prompt)).not.toContain(secret);
    expect(JSON.stringify(prompt)).toContain("cred12345678");
    expect(JSON.stringify(prompt)).not.toContain("fillGrant");
  });

  test("el relleno por HTTP no devuelve la clave ni la manda a xAI", async () => {
    const secret = "ZzVaultSecret99";
    const username = "user-sii-9988";
    const seen: string[] = [];
    const rig = fakeDesktop();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/credenciales/rellenar")) {
        return new Response(JSON.stringify({ ok: true, username, secret }), { status: 200 });
      }
      seen.push(String(init?.body));
      const step = seen.length;
      const argumentsJson =
        step === 1
          ? JSON.stringify({ action: "fill", credentialId: "cred12345678" })
          : JSON.stringify({ action: "done", result: `Listo ${secret}` });
      return new Response(JSON.stringify({ output: [{ type: "function_call", name: "computer", arguments: argumentsJson }] }), { status: 200 });
    });
    const response = await handleAgent(
      agentTask({
        goal: "Entra al SII con mi clave",
        fillGrant: "grant-de-prueba-que-no-es-la-clave",
        credentials: [{ id: "cred12345678", label: "SII", portal: "SII", usernameHint: "9988", secret }],
      }),
      {
        env: agentEnv({
          XAI_API_KEY: "xai-test",
          XAI_API_URL: "https://api.x.ai/v1",
          VAULT_FILL_URL: "https://app.test/api/credenciales/rellenar",
        }),
        desktop: rig.desktop,
        fetchImpl: fetchMock as typeof fetch,
      },
    );
    const body = response.body.toString("utf8");
    expect(response.status).toBe(200);
    expect(body).not.toContain(secret);
    expect(body).not.toContain(username);
    expect(body).toContain("[redactado]");
    expect(seen.join("\n")).not.toContain(secret);
    expect(seen.join("\n")).not.toContain("grant-de-prueba-que-no-es-la-clave");
    expect(seen.join("\n")).not.toContain("agent-token");
    expect(rig.actions).toContainEqual({ type: "type", text: secret });
  });

  test("sin token o sin la máquina pedida no abre el escritorio", async () => {
    const rig = fakeDesktop();
    const open = await handleAgent(
      { method: "POST", path: "/task", body: { goal: "Abre https://example.com", machineId: MACHINE_ID } },
      { env: { XAI_MODE: "mock", MACHINE_ID }, desktop: rig.desktop },
    );
    expect(open.status).toBe(401);
    const wrong = await handleAgent(agentTask({ goal: "Abre https://example.com", machineId: "otra-maquina" }), {
      env: agentEnv({ XAI_MODE: "mock" }),
      desktop: rig.desktop,
    });
    expect(wrong.status).toBe(403);
    expect(rig.shots()).toBe(0);
    expect(rig.actions).toHaveLength(0);
  });

  test("el modelo no puede abrir un destino privado ni de pago", async () => {
    const rig = fakeDesktop();
    const model: ComputerModel = {
      async decide() {
        return { kind: "act", action: { type: "goto", url: "http://169.254.169.254/latest" } };
      },
    };
    const privateNet = await runComputerTask({ goal: "Abre el panel interno", desktop: rig.desktop, model });
    expect(privateNet.status).toBe("FAILED");
    expect(rig.actions).toHaveLength(0);
    const checkout: ComputerModel = {
      async decide() {
        return { kind: "act", action: { type: "goto", url: "http://10.0.0.8/pago" } };
      },
    };
    const blocked = await runComputerTask({ goal: "Sigue el enlace", desktop: rig.desktop, model: checkout });
    expect(blocked.status).toBe("FAILED");
    expect(rig.actions).toHaveLength(0);
    expect(parseAction({ type: "goto", url: "http://app.internal/task" }).ok).toBe(false);
    const secret = "ZzVaultSecret99";
    const fill: ComputerModel = {
      async decide() {
        return { kind: "act", action: { type: "fill", credentialId: "cred12345678" } };
      },
    };
    const denied = await runComputerTask({
      goal: "Entra con la clave",
      desktop: rig.desktop,
      model: fill,
      allowFill: false,
      fillLogin: async () => ({ username: "user-sii-9988", secret }),
    });
    expect(denied.status).toBe("FAILED");
    expect(rig.actions).toHaveLength(0);
    expect(JSON.stringify(denied)).not.toContain(secret);
  });

  test("WhatsApp Web se abre en una pestaña si todavía no está", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).endsWith("/json/list")) {
        return new Response(JSON.stringify([{ type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://x", id: "1" }]), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const opened = await ensureWhatsappTab("http://127.0.0.1:9222", fetchMock as typeof fetch);
    expect(opened).toBe(true);
    expect(calls.some((call) => call.startsWith("PUT ") && call.includes("web.whatsapp.com"))).toBe(true);
    expect(pickWorkWindow([{ id: "wa", name: "WhatsApp" }, { id: "work", name: "Example" }])).toBe("work");
    expect(pagesFromList([{ type: "page", url: "https://web.whatsapp.com/", webSocketDebuggerUrl: "ws://x" }])).toHaveLength(1);
    expect(pngFromCdpResult({ data: PNG.toString("base64") })?.length).toBe(PNG.length);
    expect(buildComputerRequest({ model: "grok-4.7", goal: "mira", screenshot: PNG, history: [] }).model).toBe("grok-4.7");
  });

  test("el token no entra al modelo, el apretón no declara RUNNING y la acción exige una tarea", async () => {
    resetAgentTasks();
    const seen: string[] = [];
    const rig = fakeDesktop();
    const result = await runComputerTask({
      goal: `Abre example.com ${AGENT_TOKEN}`,
      desktop: rig.desktop,
      model: {
        async decide(ctx) {
          seen.push(ctx.goal);
          return { kind: "done", result: `Listo ${AGENT_TOKEN}` };
        },
      },
      redactSecrets: [AGENT_TOKEN],
    });
    expect(seen.join("\n")).not.toContain(AGENT_TOKEN);
    expect(result.result).not.toContain(AGENT_TOKEN);

    const handshakeBody = { nonce: "nonce-de-prueba-0001", machineId: MACHINE_ID, host: DOMAIN };
    const handshakeRaw = JSON.stringify(handshakeBody);
    const handshake = await handleAgent(
      {
        method: "POST",
        path: "/handshake",
        body: handshakeBody,
        rawBody: handshakeRaw,
        headers: signRequest({ token: AGENT_TOKEN, method: "POST", path: "/handshake", body: handshakeRaw, host: DOMAIN }),
      },
      { env: agentEnv(), desktop: rig.desktop },
    );
    const proof = JSON.parse(handshake.body.toString("utf8")) as { proof?: string; status?: string };
    expect(handshake.status).toBe(200);
    expect(proof.proof).toBeTruthy();
    expect(handshake.body.toString("utf8")).not.toContain(AGENT_TOKEN);
    expect(proof.status).toBeUndefined();

    const taskId = "task-cancel-0001";
    const before = rig.shots();
    const early = await handleAgent(agentTask({ taskId }, "/task/cancel"), {
      env: agentEnv({ XAI_MODE: "mock" }),
      desktop: rig.desktop,
    });
    expect(early.status).toBe(200);
    const blocked = await handleAgent(agentTask({ goal: "Abre https://example.com", taskId }), {
      env: agentEnv({ XAI_MODE: "mock" }),
      desktop: rig.desktop,
    });
    expect(JSON.parse(blocked.body.toString("utf8")).status).toBe("FAILED");
    expect(rig.shots()).toBe(before);

    const denied = await handleAgent(agentTask({ type: "click", x: 1, y: 1, taskId: "task-ausente-01" }, "/action"), {
      env: agentEnv(),
      desktop: rig.desktop,
    });
    expect(denied.status).toBe(403);
    expect(rig.actions).toHaveLength(0);
  });

  test("el servidor entrega el cuerpo crudo y una época vacía no abre la tarea", async () => {
    resetAgentTasks();
    const rig = fakeDesktop();
    const payload = { machineId: MACHINE_ID, epoch: 1, goal: "Abre https://example.com" };
    const raw = Buffer.from(JSON.stringify(payload));
    const signed = signRequest({ token: AGENT_TOKEN, method: "POST", path: "/task", body: raw.toString("utf8"), host: DOMAIN });
    const request = readAgentHttp("POST", "/task", raw, signed);
    expect(request.rawBody).toBe(raw.toString("utf8"));
    const response = await handleAgent(request, { env: agentEnv({ XAI_MODE: "mock" }), desktop: rig.desktop });
    expect(response.status).toBe(200);
    const blocked = await handleAgent(
      { ...request, rawBody: raw.toString("utf8"), headers: signRequest({ token: AGENT_TOKEN, method: "POST", path: "/task", body: raw.toString("utf8"), host: DOMAIN }) },
      { env: agentEnv({ XAI_MODE: "mock", LEASE_EPOCH: "" }), desktop: rig.desktop },
    );
    expect(blocked.status).toBe(409);
    rememberSeenNonce("nonce-viejo-00000001", 1_000);
    expect(nonceStillSeen("nonce-viejo-00000001", 1_010)).toBe(true);
    expect(nonceStillSeen("nonce-viejo-00000001", 1_121)).toBe(false);
  });
});
