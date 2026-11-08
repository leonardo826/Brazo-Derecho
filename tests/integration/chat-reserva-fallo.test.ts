import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { prepareUpload } from "@/lib/chat/files";
import { streamChatTurn } from "@/lib/chat/run";
import { tasksToday } from "@/lib/meter-store";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/lib/usage";
import * as xai from "@/lib/xai/client";
import { USAGE_PRESETS, type TokenUsage } from "@/lib/pricing";
import type { XaiRequest, XaiResponse, XaiStreamEvent } from "@/lib/xai/types";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const BASELINE = 4;

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `falla-${suffix}@test.local`,
      name: "Ana",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: { role: "OWNER", organization: { create: { name: "Falla", slug: `falla-${suffix}` } } },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("sin empresa");
  createdOrgs.push(organizationId);
  const now = new Date();
  await prisma.usageMonth.create({
    data: { organizationId, yearMonth: monthKey(now), tasksCount: BASELINE },
  });
  for (let index = 0; index < BASELINE; index += 1) {
    await prisma.usageMeter.create({
      data: { organizationId, kind: "TASK", model: "", createdAt: now },
    });
  }
  return organizationId;
}

async function counts(organizationId: string) {
  const now = new Date();
  const month = await prisma.usageMonth.findUniqueOrThrow({
    where: { organizationId_yearMonth: { organizationId, yearMonth: monthKey(now) } },
  });
  return { tasks: await tasksToday(organizationId, now), tasksCount: month.tasksCount };
}

async function drain(organizationId: string, text: string, signal?: AbortSignal) {
  const events = [];
  for await (const event of streamChatTurn({
    organizationId,
    organizationName: "Falla",
    actorUserId: "user",
    text,
    files: [],
    signal,
  })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("la reserva no se pierde si el contexto falla", () => {
  test("si el historial falla, el cupo vuelve y el modelo no parte", async () => {
    const organizationId = await makeOrg();
    const model = vi.spyOn(xai, "createXaiClient");
    vi.spyOn(prisma.agentMessage, "findMany").mockRejectedValue(new Error("historial-falla"));
    await expect(drain(organizationId, "Resume el IVA en dos frases")).rejects.toThrow("historial-falla");
    expect(await counts(organizationId)).toEqual({ tasks: BASELINE, tasksCount: BASELINE });
    expect(model).not.toHaveBeenCalled();
    expect(await prisma.agentMessage.count({ where: { thread: { organizationId }, role: "ASSISTANT" } })).toBe(0);
  });

  test("si se aborta mientras se lee el historial, el cupo vuelve y el modelo no parte", async () => {
    const organizationId = await makeOrg();
    const model = vi.spyOn(xai, "createXaiClient");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = prisma.agentMessage.findMany.bind(prisma.agentMessage);
    vi.spyOn(prisma.agentMessage, "findMany").mockImplementation((async (args: unknown) => {
      await gate;
      return original(args as never);
    }) as typeof prisma.agentMessage.findMany);
    const controller = new AbortController();
    const running = drain(organizationId, "Resume el IVA en dos frases", controller.signal);
    await vi.waitFor(async () => {
      expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);
    });
    controller.abort();
    release();
    await running;
    expect(await counts(organizationId)).toEqual({ tasks: BASELINE, tasksCount: BASELINE });
    expect(model).not.toHaveBeenCalled();
  });

  test("veinte ejemplos se completan en otro tramo y un corte se declara", async () => {
    // Cliente falso. No prueba que un modelo live cierre veinte ejemplos.
    const organizationId = await makeOrg();
    let calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: "delta", text: "1. Ejemplo uno\n" };
          yield {
            type: "done",
            response: {
              id: "r1",
              model: "grok-4.7",
              outputText: "1. Ejemplo uno\n",
              usage: USAGE_PRESETS.text,
              mocked: true,
              incomplete: true,
            },
          };
          return;
        }
        const rest = Array.from({ length: 19 }, (_, index) => `${index + 2}. Ejemplo ${index + 2}`).join("\n");
        yield { type: "delta", text: rest };
        yield {
          type: "done",
          response: {
            id: "r2",
            model: "grok-4.7",
            outputText: rest,
            usage: USAGE_PRESETS.text,
            mocked: true,
            incomplete: false,
          },
        };
      },
    }));
    const events = await drain(organizationId, "Dame 20 ejemplos completos de asientos simples");
    const saved = events.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toContain("1. Ejemplo uno");
    expect(body).toContain("20. Ejemplo 20");
    expect(body).not.toContain("quedó cortada");
    expect(calls).toBe(2);
    expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);

    calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        yield { type: "delta", text: `tramo ${calls}. ` };
        yield {
          type: "done",
          response: {
            id: `c${calls}`,
            model: "grok-4.7",
            outputText: `tramo ${calls}. `,
            usage: USAGE_PRESETS.text,
            mocked: true,
            incomplete: true,
          },
        };
      },
    }));
    const cut = await drain(organizationId, "Desarrolla el fundamento completo del IVA");
    const cutSaved = cut.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const cutBody = cutSaved && cutSaved.type === "message" ? cutSaved.message.body : "";
    expect(cutBody).toContain("tramo 1");
    expect(cutBody).toContain("tramo 4");
    expect(cutBody).toContain("(Respuesta incompleta por el límite de salida.)");
    expect(calls).toBe(4);
    expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);
  });
});

const PRESET = USAGE_PRESETS.text;

function bill(id: string, model: string, usage: TokenUsage, incomplete: boolean): XaiResponse {
  return { id, model, outputText: "", usage, mocked: false, incomplete };
}

function notPreset(usage: TokenUsage) {
  expect(usage.inputTokens).not.toBe(PRESET.inputTokens);
  expect(usage.outputTokens).not.toBe(PRESET.outputTokens);
  expect(usage.cachedTokens).not.toBe(PRESET.cachedTokens);
}

async function ledger(organizationId: string) {
  const chats = await prisma.usageMeter.findMany({
    where: { organizationId, kind: "CHAT" },
    orderBy: { createdAt: "asc" },
  });
  const consults = await prisma.usageEvent.findMany({
    where: { organizationId, metric: "CONSULTS" },
    orderBy: { createdAt: "asc" },
  });
  const month = await prisma.usageMonth.findUniqueOrThrow({
    where: { organizationId_yearMonth: { organizationId, yearMonth: monthKey(new Date()) } },
  });
  return { chats, consults, month };
}

describe("el consumo guardado es el del proveedor", () => {
  test("dos tramos con usos distintos no se reemplazan por el preset", async () => {
    const organizationId = await makeOrg();
    const first = { inputTokens: 111, cachedTokens: 11, outputTokens: 21 };
    const second = { inputTokens: 222, cachedTokens: 22, outputTokens: 32 };
    notPreset(first);
    notPreset(second);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    let calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: "delta", text: "1. Ejemplo uno\n" };
          yield { type: "done", response: { ...bill("resp_tramo_uno", "grok-4.7", first, true), outputText: "1. Ejemplo uno\n" } };
          return;
        }
        yield { type: "delta", text: "2. Ejemplo dos" };
        yield { type: "done", response: { ...bill("resp_tramo_dos", "grok-4.3", second, false), outputText: "2. Ejemplo dos" } };
      },
    }));
    const events = await drain(organizationId, "Dame 20 ejemplos completos de asientos simples");
    const saved = events.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toContain("1. Ejemplo uno");
    expect(body).toContain("2. Ejemplo dos");
    expect(body).not.toContain("incompleta");
    const rows = await ledger(organizationId);
    expect(rows.chats.map((row) => ({
      model: row.model,
      inputTokens: row.inputTokens,
      cachedTokens: row.cachedTokens,
      outputTokens: row.outputTokens,
      synthetic: row.synthetic,
    }))).toEqual([
      { model: "grok-4.7", ...first, synthetic: false },
      { model: "grok-4.3", ...second, synthetic: false },
    ]);
    expect(rows.consults).toHaveLength(1);
    expect(rows.consults[0]).toMatchObject({
      quantity: 1,
      model: "grok-4.3",
      inputTokens: 333,
      cachedTokens: 33,
      outputTokens: 53,
    });
    expect(rows.month.inputTokens).toBe(333);
    expect(rows.month.outputTokens).toBe(53);
    expect(rows.month.tasksCount).toBe(BASELINE + 1);
    const consumo = lines.map((line) => {
      try {
        return JSON.parse(line) as { event?: string; responseId?: string; inputTokens?: number };
      } catch {
        return null;
      }
    }).filter((row) => row?.event === "chat.consumo");
    expect(consumo.map((row) => row?.responseId)).toEqual(["resp_tramo_uno", "resp_tramo_dos"]);
    expect(lines.join("\n")).not.toContain("Ejemplo uno");
    expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);
  });

  test("un corte guarda el costo y no la tarea; un fallo posterior conserva el parcial", async () => {
    const organizationId = await makeOrg();
    const cutUsage = { inputTokens: 41, cachedTokens: 5, outputTokens: 7 };
    notPreset(cutUsage);
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        yield { type: "delta", text: "Alcancé el tope." };
        yield { type: "done", response: { ...bill("resp_corte", "grok-4.7", cutUsage, true), outputText: "Alcancé el tope." } };
      },
    }));
    const cut = await drain(organizationId, "Resume el IVA en dos frases");
    const cutSaved = cut.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const cutBody = cutSaved && cutSaved.type === "message" ? cutSaved.message.body : "";
    expect(cutBody).toContain("Alcancé el tope.");
    expect(cutBody).toContain("(Respuesta incompleta por el límite de salida.)");
    let rows = await ledger(organizationId);
    expect(rows.chats).toHaveLength(1);
    expect(rows.chats[0]).toMatchObject({ ...cutUsage, synthetic: false });
    expect(rows.consults).toHaveLength(1);
    expect(rows.consults[0]).toMatchObject({ quantity: 1, ...cutUsage });
    expect((await counts(organizationId)).tasks).toBe(BASELINE);

    const prior = { inputTokens: 55, cachedTokens: 6, outputTokens: 8 };
    notPreset(prior);
    let calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: "delta", text: "Parte útil." };
          yield { type: "done", response: { ...bill("resp_previo", "grok-4.7", prior, true), outputText: "Parte útil." } };
          return;
        }
        throw new Error("corte-red");
      },
    }));
    const failed = await drain(organizationId, "Desarrolla el fundamento completo del IVA");
    const failedSaved = failed.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const failedBody = failedSaved && failedSaved.type === "message" ? failedSaved.message.body : "";
    expect(failedBody).toContain("Parte útil.");
    expect(failedBody).toContain("(Respuesta incompleta por un fallo al continuar.)");
    expect(failedBody).not.toContain("No alcancé a responder");
    expect(failed.some((event) => event.type === "error")).toBe(false);
    rows = await ledger(organizationId);
    expect(rows.chats.map((row) => row.inputTokens)).toEqual([cutUsage.inputTokens, prior.inputTokens]);
    expect(rows.consults).toHaveLength(2);
    expect(rows.consults[1]).toMatchObject({ quantity: 1, ...prior });
    expect(rows.month.tasksCount).toBe(BASELINE);
    expect((await counts(organizationId)).tasks).toBe(BASELINE);
  });

  test("sin texto el corte no deja solo el aviso ni cuenta la consulta", async () => {
    const organizationId = await makeOrg();
    const usage = { inputTokens: 8, cachedTokens: 1, outputTokens: 2 };
    notPreset(usage);
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        yield { type: "done", response: bill("resp_vacio", "grok-4.3", usage, true) };
      },
    }));
    const events = await drain(organizationId, "Resume el IVA en dos frases");
    const saved = events.find((event) => event.type === "message");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toBe("No alcancé a responder. No descontamos esta vez.");
    expect(body).not.toContain("incompleta");
    const rows = await ledger(organizationId);
    expect(rows.chats[0]).toMatchObject({ model: "grok-4.3", ...usage, synthetic: false });
    expect(rows.consults).toHaveLength(0);
    expect(rows.month.tasksCount).toBe(BASELINE);
    expect(rows.month.inputTokens).toBe(usage.inputTokens);
  });

  test("un PDF de F29 legítimo llega al modelo con el texto original", async () => {
    const organizationId = await makeOrg();
    const pdf = prepareUpload("f29.pdf", new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"));
    expect(pdf?.mimeType).toBe("application/pdf");
    const captured: { request: XaiRequest | null } = { request: null };
    const usage = { inputTokens: 17, cachedTokens: 3, outputTokens: 9 };
    notPreset(usage);
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(request: XaiRequest): AsyncGenerator<XaiStreamEvent> {
        captured.request = request;
        yield {
          type: "done",
          response: {
            ...bill("resp_f29", "grok-4.7", usage, false),
            outputText: "El F29 declara el IVA del período.",
          },
        };
      },
    }));
    const phrase = "Guarda el formulario 29 del SII";
    const events = [];
    for await (const event of streamChatTurn({
      organizationId,
      organizationName: "Falla",
      actorUserId: "user",
      text: phrase,
      files: pdf ? [pdf] : [],
    })) {
      events.push(event);
    }
    const request = captured.request;
    expect(request?.task.type).toBe("agent_chat");
    if (request?.task.type !== "agent_chat") throw new Error("el modelo no recibió el pedido");
    const last = request.task.messages.at(-1);
    expect(last?.text).toBe(phrase);
    expect(last?.files?.map((file) => file.name)).toEqual(["f29.pdf"]);
    expect(last?.files?.[0]?.note).toContain("f29.pdf");
    const user = events.find((event) => event.type === "user");
    expect(user && user.type === "user" ? user.message.body : "").toBe(phrase);
    const saved = events.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toContain("El F29 declara el IVA del período.");
    expect(body).not.toContain("/panel/boveda");
    const attachment = await prisma.agentAttachment.findFirstOrThrow({
      where: { organizationId, fileName: "f29.pdf" },
    });
    expect(attachment.mimeType).toBe("application/pdf");
    expect(Buffer.from(attachment.bytes).subarray(0, 4).toString()).toBe("%PDF");
    const rows = await ledger(organizationId);
    expect(rows.chats[0]).toMatchObject({ ...usage, model: "grok-4.7", synthetic: false });
    expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);
  });
});
