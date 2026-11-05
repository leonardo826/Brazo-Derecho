import { describe, expect, test, vi } from "vitest";
import { parseAction, parseHttpUrl, xdotoolArgs, type DesktopAction } from "../../agent-runtime/src/actions";
import { pagesFromList, pngFromCdpResult, ensureWhatsappTab } from "../../agent-runtime/src/cdp";
import type { Desktop } from "../../agent-runtime/src/desktop";
import { pickWorkWindow } from "../../agent-runtime/src/desktop";
import { handleAgent } from "../../agent-runtime/src/http";
import { mockUrlForGoal } from "../../agent-runtime/src/mock";
import { runComputerTask } from "../../agent-runtime/src/loop";
import { createMockModel } from "../../agent-runtime/src/mock";
import { isBulkGoal, isSensitiveGoal } from "../../agent-runtime/src/sensitive";
import { buildComputerRequest, createLiveComputerModel, resolveXaiMode } from "../../agent-runtime/src/xai";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
      { method: "POST", path: "/task", body: { goal: "Abre https://example.com y dime el título" } },
      { env: { XAI_MODE: "mock", XAI_API_KEY: "no-usar" }, desktop: rig.desktop, fetchImpl: fetchMock as typeof fetch },
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
    expect(xdotoolArgs(parsed.action as Exclude<typeof parsed.action, { type: "goto" }>)).toEqual([
      "mousemove",
      "--sync",
      "10",
      "20",
      "click",
      "1",
    ]);
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
});
