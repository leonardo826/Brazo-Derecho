import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { handleAgent } from "../../agent-runtime/src/http";
import type { Desktop, DesktopStatus } from "../../agent-runtime/src/desktop";
import type { DesktopAction } from "../../agent-runtime/src/actions";
import { accountantChatInstructions } from "@/lib/chat/accountant";
import { AGENT_CATALOG } from "@/lib/catalog";
import {
  DESKTOP_COPY,
  executeDesktopRequest,
  planDesktopTask,
  resetDesktopIntent,
  type ComputerLease,
  type LeaseState,
} from "@/lib/chat/desktop-task";

const SECRET = "Secreto-latam-88";
const ORG = "org-a";
const USER = "persona-a";
const THREAD = "contador";

const lease = (organizationId = ORG): ComputerLease => ({
  organizationId,
  machineId: "machine-1",
  baseUrl: "http://127.0.0.1:9",
  token: "lease-de-esa-maquina",
});

const ready = (organizationId = ORG): LeaseState => ({ state: "listo", lease: lease(organizationId) });

function run(text: string, extra: Partial<Parameters<typeof executeDesktopRequest>[0]> = {}) {
  return executeDesktopRequest({
    organizationId: ORG,
    userId: USER,
    conversationId: THREAD,
    text,
    loadLease: async () => ({ state: "ausente" }),
    reserve: async () => ({ ok: true, reservationId: "reserva" }),
    ...extra,
  });
}

afterEach(() => {
  resetDesktopIntent();
  delete process.env.COMPUTER_AGENT_URL;
  delete process.env.COMPUTER_AGENT_TOKEN;
});

describe("contrato del computador en el chat", () => {
  test("la especialidad no prohíbe la herramienta y un viaje pide la fecha", async () => {
    const instructions = `${AGENT_CATALOG.ACCOUNTING.instructions}\n${accountantChatInstructions("QA")}`;
    expect(instructions).not.toMatch(/no operas un computador/i);
    expect(instructions).toMatch(/no rechaces un pedido por ser el contador/i);
    expect(planDesktopTask("Explícame el IVA del F29").kind).toBe("chat");
    const asked = await run("Cotiza vuelos CCP SCL");
    expect(asked).toEqual({ kind: "reply", text: "¿Qué fecha y es solo ida o ida y vuelta?" });
  });

  test("la segunda respuesta completa la intención y no cae en el chat", async () => {
    const order: string[] = [];
    await run("Cotiza vuelos CCP SCL");
    const result = await run("12 de diciembre, solo ida", {
      loadLease: async () => ({ state: "transporte" }),
      reserve: async () => {
        order.push("reserva");
        return { ok: true, reservationId: "reserva" };
      },
      fetchImpl: (async () => {
        order.push("fetch");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(result.kind).toBe("reply");
    if (result.kind !== "reply") return;
    expect(result.text).toBe(DESKTOP_COPY.TRANSPORT);
    expect(order).toEqual([]);
    const other = await executeDesktopRequest({
      organizationId: "org-b",
      userId: USER,
      conversationId: THREAD,
      text: "12 de diciembre, solo ida",
      allowLoopback: true,
      loadLease: async () => ready(),
      fetchImpl: (async () => {
        throw new Error("no debía llamar");
      }) as typeof fetch,
    });
    expect(other.kind).toBe("chat");
  });

  test("sin arriendo alcanzable no usa la red interna ni un token global", async () => {
    process.env.COMPUTER_AGENT_URL = "http://app.internal:8787";
    process.env.COMPUTER_AGENT_TOKEN = "token-global";
    const fetchImpl = (async () => {
      throw new Error("no debía llamar");
    }) as typeof fetch;
    const absent = await run("Cotiza vuelos CCP SCL el 12 de diciembre, solo ida", { fetchImpl });
    expect(absent).toEqual({ kind: "reply", text: DESKTOP_COPY.ABSENT });
    const internal = await run("Cotiza vuelos CCP SCL el 12 de diciembre, solo ida", {
      loadLease: async () => ({
        state: "listo",
        lease: { ...lease(), baseUrl: "http://iabot-desk-empresa.internal:8787" },
      }),
      fetchImpl,
    });
    expect(internal).toEqual({ kind: "reply", text: DESKTOP_COPY.TRANSPORT });
  });

  test("un DONE con solo captura no acredita fuente y la respuesta no trae secreto", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      expect(JSON.stringify(init?.headers)).toContain("lease-de-esa-maquina");
      expect(JSON.stringify(init?.headers)).not.toContain(SECRET);
      return new Response(
        JSON.stringify({
          status: "DONE",
          xaiMode: "live",
          steps: [{ kind: "screenshot", bytes: 10 }],
          result: `Listo. clave: ${SECRET}`,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const result = await run("Cotiza vuelos CCP SCL el 12 de diciembre, solo ida", {
      allowLoopback: true,
      loadLease: async () => ready(),
      fetchImpl,
    });
    expect(result).toEqual({ kind: "reply", text: DESKTOP_COPY.NOT_REAL });
    const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["goal", "machineId"]);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  test("la reserva ocurre antes de la llamada y el tope no llama", async () => {
    const order: string[] = [];
    const blocked = await run("Usa el computador y abre https://example.com", {
      allowLoopback: true,
      loadLease: async () => ready(),
      reserve: async () => {
        order.push("reserva");
        return { ok: false };
      },
      fetchImpl: (async () => {
        order.push("fetch");
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(blocked).toEqual({ kind: "reply", text: DESKTOP_COPY.LIMITE });
    expect(order).toEqual(["reserva"]);
  });

  test("comprar pide confirmación", async () => {
    const result = await run("Compra el pasaje del viaje el 12 de diciembre, solo ida", {
      allowLoopback: true,
      loadLease: async () => ready(),
      fetchImpl: (async () => {
        throw new Error("no debía llamar");
      }) as typeof fetch,
    });
    expect(result).toEqual({ kind: "confirm" });
  });

  test("cancelar avisa al runtime y no deja un resultado", async () => {
    const cancelled: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { machineId?: string };
      if ((req.url ?? "").startsWith("/task/cancel")) cancelled.push("cancel");
      const response = await handleAgent(
        {
          method: req.method ?? "GET",
          path: req.url ?? "/",
          body,
          headers: { authorization: req.headers.authorization },
        },
        {
          env: { AGENT_RUNTIME_TOKEN: "lease-de-esa-maquina", MACHINE_ID: "machine-1", XAI_MODE: "mock" },
          desktop: waitingDesktop(cancelled),
        },
      );
      res.writeHead(response.status);
      res.end(response.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const controller = new AbortController();
    const pending = run("Usa el computador y abre https://example.com", {
      allowLoopback: true,
      loadLease: async () => ({
        state: "listo",
        lease: { ...lease(), baseUrl: `http://127.0.0.1:${port}` },
      }),
      signal: controller.signal,
      timeoutMs: 2_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    const result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    expect(result).toEqual({ kind: "reply", text: DESKTOP_COPY.CANCELLED });
    expect(cancelled).toContain("cancel");
  });
});

function waitingDesktop(marks: string[]): Desktop {
  const status: DesktopStatus = { ok: true, display: ":99", chromium: "up", whatsappTab: false, profileDir: "/tmp/none" };
  return {
    async screenshot() {
      marks.push("shot");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return Buffer.from("png");
    },
    async perform(action: DesktopAction) {
      marks.push(action.type);
    },
    async status() {
      return status;
    },
  };
}
