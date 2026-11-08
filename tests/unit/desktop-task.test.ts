import { afterEach, describe, expect, test, vi } from "vitest";
import { accountantChatInstructions } from "@/lib/chat/accountant";
import { AGENT_CATALOG } from "@/lib/catalog";
import { DESKTOP_COPY, executeDesktopRequest, planDesktopTask, type TenantComputer } from "@/lib/chat/desktop-task";

const SECRET = "Secreto-latam-88";
const FLIGHT = "Entra a una aerolínea chilena y cotiza vuelos Concepción a Santiago el 12 de diciembre, solo ida";
const OPEN = "Cotiza vuelos Concepción a Santiago";

const running = (clientId: string, flyApp = "iabot-desk-empresa"): TenantComputer => ({
  clientId,
  status: "RUNNING",
  flyApp,
  machineId: "machine-1",
});

const liveBody = {
  status: "DONE",
  xaiMode: "live",
  steps: [{ kind: "screenshot" }],
  result: `Tarifa publicada en el sitio. clave: ${SECRET}`,
};

afterEach(() => {
  delete process.env.COMPUTER_AGENT_URL;
  delete process.env.COMPUTER_AGENT_TOKEN;
  vi.restoreAllMocks();
});

describe("tarea de computador desde el chat", () => {
  test("la especialidad no prohíbe el computador", () => {
    const instructions = `${AGENT_CATALOG.ACCOUNTING.instructions}\n${accountantChatInstructions("QA")}`;
    expect(instructions).not.toMatch(/no operas un computador/i);
    expect(instructions).toMatch(/no rechaces un pedido por ser el contador/i);
    expect(instructions).toMatch(/no afirmes una visita, una tarifa/i);
    expect(planDesktopTask(OPEN).kind).toBe("ask");
    expect(planDesktopTask("Explícame el IVA del F29").kind).toBe("chat");
  });

  test("un vuelo sin fecha pregunta lo mínimo y no llama al computador", async () => {
    const fetchImpl = vi.fn();
    const logs: string[] = [];
    const result = await executeDesktopRequest({
      organizationId: "org-a",
      text: OPEN,
      loadComputer: async () => running("org-a"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: (fields) => logs.push(JSON.stringify(fields)),
    });
    expect(result).toEqual({ kind: "reply", text: "¿Qué fecha y es solo ida o ida y vuelta?" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs.join(" ")).not.toContain(SECRET);
  });

  test("con fecha e ida llama solo al computador de esa empresa", async () => {
    process.env.COMPUTER_AGENT_URL = "http://compartido.example";
    process.env.COMPUTER_AGENT_TOKEN = "token-global";
    const bodies: string[] = [];
    const headers: HeadersInit[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      headers.push(init?.headers ?? {});
      expect(url).toBe("http://iabot-desk-empresa.internal:8787/task");
      return new Response(JSON.stringify(liveBody), { status: 200 });
    });
    const result = await executeDesktopRequest({
      organizationId: "org-a",
      text: FLIGHT,
      loadComputer: async (organizationId) => (organizationId === "org-a" ? running("org-a") : null),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") return;
    expect(result.text).toContain("Tarifa publicada");
    expect(result.text).not.toContain(SECRET);
    expect(result.text).toContain("[redactado]");
    const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["goal"]);
    expect(JSON.stringify(headers)).not.toContain("token-global");
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  test("otra empresa no usa el computador ajeno", async () => {
    const fetchImpl = vi.fn();
    const result = await executeDesktopRequest({
      organizationId: "org-b",
      text: FLIGHT,
      loadComputer: async (organizationId) => (organizationId === "org-a" ? running("org-a") : null),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "reply", text: DESKTOP_COPY.ABSENT });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sin computador en marcha el error es honesto y no hay éxito simulado", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "DONE", xaiMode: "mock", result: "tarifa 1" }), { status: 200 }));
    const stopped = await executeDesktopRequest({
      organizationId: "org-a",
      text: FLIGHT,
      loadComputer: async () => ({ ...running("org-a"), status: "STOPPED" }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(stopped).toEqual({ kind: "reply", text: DESKTOP_COPY.ABSENT });
    expect(fetchImpl).not.toHaveBeenCalled();
    const mock = await executeDesktopRequest({
      organizationId: "org-a",
      text: FLIGHT,
      loadComputer: async () => running("org-a"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(mock).toEqual({ kind: "reply", text: DESKTOP_COPY.NOT_REAL });
  });

  test("comprar el pasaje pide confirmación y no llama", async () => {
    const fetchImpl = vi.fn();
    const result = await executeDesktopRequest({
      organizationId: "org-a",
      text: "Compra el pasaje LATAM el 12 de diciembre, solo ida",
      loadComputer: async () => running("org-a"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ kind: "confirm" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("cancelar y el tiempo agotado no dejan una tarifa", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    const cancelled = await executeDesktopRequest({
      organizationId: "org-a",
      text: FLIGHT,
      signal: controller.signal,
      loadComputer: async () => running("org-a"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(cancelled).toEqual({ kind: "reply", text: DESKTOP_COPY.CANCELLED });
    expect(fetchImpl).not.toHaveBeenCalled();

    const slow = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("tiempo"), { name: "TimeoutError" }));
        });
      });
    });
    const logs: { outcome: string; ms: number }[] = [];
    const timed = await executeDesktopRequest({
      organizationId: "org-a",
      text: FLIGHT,
      timeoutMs: 5,
      loadComputer: async () => running("org-a"),
      fetchImpl: slow as unknown as typeof fetch,
      log: (fields) => logs.push(fields),
    });
    expect(timed).toEqual({ kind: "reply", text: DESKTOP_COPY.TIMEOUT });
    expect(logs.some((item) => item.outcome === "timeout" && item.ms >= 0)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("Concepción");
  });
});
