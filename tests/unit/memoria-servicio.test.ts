import { beforeEach, describe, expect, test, vi } from "vitest";

type FactWrite = {
  data: {
    text: string;
    organizationId: string;
    sourceConversationId: string | null;
    agent: string | null;
  };
};

type FactErase = {
  where: { id?: string; organizationId: string; deletedAt: null; OR?: { agent: string | null }[] };
  data: { text: string; deletedAt: Date };
};

const db = vi.hoisted(() => ({
  memoryFact: {
    findMany: vi.fn(),
    create: vi.fn(async (input: FactWrite) => ({ id: input.data.organizationId })),
    updateMany: vi.fn(async (input: FactErase) => ({ count: input.where.organizationId ? 1 : 0 })),
  },
  agentThread: { findUnique: vi.fn() },
  agentMessage: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code = "P2002";
    },
  },
  prisma: {
    memoryFact: db.memoryFact,
    agentThread: db.agentThread,
    agentMessage: db.agentMessage,
    $transaction: async (fn: (tx: { memoryFact: typeof db.memoryFact }) => Promise<unknown>) => fn({ memoryFact: db.memoryFact }),
  },
}));

vi.mock("@/lib/meter-store", () => ({
  recordModelCall: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/guard", () => ({
  guardMutation: vi.fn(async () => undefined),
  assertOwnOrganizationActive: vi.fn(async () => undefined),
  withNotice: (path: string, key: string, code: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${code}`,
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    userId: "user-a",
    email: "a@brazo.cl",
    name: "Ana",
    organizationId: "org-a",
    organizationName: "Los Aromos",
    role: "OWNER" as const,
    authVersion: 0,
  })),
}));

import { forgetAllMemoryAction, forgetMemoryAction } from "@/app/actions/memory";
import { captureChatMemory } from "@/lib/memory/capture";
import { memoryPrompt, rememberLatestChatTurn, rememberTurn } from "@/lib/memory/service";
import { recordModelCall } from "@/lib/meter-store";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function* events(items: { role: "USER" | "ASSISTANT"; kind: "TEXT" | "CONFIRMATION"; body: string }[]) {
  for (const item of items) {
    yield {
      type: "message" as const,
      message: {
        id: "m1",
        role: item.role,
        kind: item.kind,
        body: item.body,
        action: "",
        actionTitle: "",
        confirmation: null,
        createdAt: new Date().toISOString(),
        attachments: [],
      },
    };
  }
  yield { type: "done" as const };
}

describe("memoria por empresa", () => {
  beforeEach(() => {
    delete process.env.MEMORY_FEATURE_ENABLED;
    db.memoryFact.findMany.mockReset();
    db.memoryFact.create.mockClear();
    db.memoryFact.updateMany.mockClear();
    db.agentThread.findUnique.mockReset();
    db.agentMessage.findMany.mockReset();
    vi.mocked(recordModelCall).mockClear();
  });

  test("apagada no lee ni escribe", async () => {
    expect(await memoryPrompt({ organizationId: "org-a", agent: "ACCOUNTING", query: "rut" })).toBe("");
    expect(await rememberTurn({
      organizationId: "org-a",
      agent: "ACCOUNTING",
      sourceConversationId: "hilo",
      userText: "La empresa se llama Los Aromos.",
      assistantText: "Anotado.",
    })).toEqual({ saved: 0 });
    expect(db.memoryFact.findMany).not.toHaveBeenCalled();
    const seen: string[] = [];
    for await (const event of captureChatMemory(
      "org-a",
      "ACCOUNTING",
      events([{ role: "ASSISTANT", kind: "TEXT", body: "Listo." }]),
    )) {
      if (event.type === "done") seen.push(event.type);
    }
    expect(seen).toEqual(["done"]);
    expect(db.agentThread.findUnique).not.toHaveBeenCalled();
  });

  test("después del turno guarda el dato y no la clave", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "true";
    db.memoryFact.findMany.mockResolvedValue([]);
    db.agentThread.findUnique.mockResolvedValue({ id: "hilo-1" });
    db.agentMessage.findMany.mockResolvedValue([
      { role: "ASSISTANT", body: "Quedó anotado.", createdAt: new Date() },
      { role: "USER", body: "La empresa se llama Ferretería Los Aromos. El rubro es ferretería.", createdAt: new Date(Date.now() - 1000) },
    ]);
    await rememberLatestChatTurn("org-a", "ACCOUNTING");
    const texts = db.memoryFact.create.mock.calls.map((call) => call[0].data.text as string);
    expect(texts.some((text) => text.includes("Ferretería Los Aromos"))).toBe(true);
    expect(texts.some((text) => text.includes("ferretería"))).toBe(true);
    expect(texts.join(" ")).not.toMatch(/clave|password|4111/i);
    expect(db.memoryFact.create.mock.calls[0]?.[0].data.organizationId).toBe("org-a");
    expect(db.memoryFact.create.mock.calls[0]?.[0].data.sourceConversationId).toBe("hilo-1");
    expect(recordModelCall).toHaveBeenCalled();
  });

  test("un modelo que devuelve una tarjeta no la guarda, y un duplicado tampoco", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "true";
    db.memoryFact.findMany.mockResolvedValue([
      { id: "ya", text: "El rubro es panadería.", contentHash: "igual", deletedAt: null },
    ]);
    const result = await rememberTurn({
      organizationId: "org-a",
      agent: "WHATSAPP",
      sourceConversationId: "conv",
      userText: "Somos una panadería.",
      assistantText: "Anotado.",
      complete: async () =>
        JSON.stringify({
          hechos: [
            { texto: "La tarjeta es 4111111111111111.", alcance: "empresa" },
            { texto: "El rubro es panadería.", alcance: "empresa" },
            { texto: "El tono que prefieren es breve.", alcance: "agente" },
          ],
        }),
    });
    expect(result.saved).toBe(1);
    expect(db.memoryFact.create).toHaveBeenCalledTimes(1);
    expect(db.memoryFact.create.mock.calls[0]?.[0].data.text).toBe("El tono que prefieren es breve.");
    expect(db.memoryFact.create.mock.calls[0]?.[0].data.agent).toBe("WHATSAPP");
    expect(recordModelCall).not.toHaveBeenCalled();
  });

  test("borrar un dato y borrar todo vacían el texto de esta empresa", async () => {
    process.env.MEMORY_FEATURE_ENABLED = "true";
    await expect(forgetMemoryAction(form({ agente: "ACCOUNTING", id: "fact-1" }))).rejects.toThrow(
      "REDIRECT:/panel/contador?ok=memoria",
    );
    expect(db.memoryFact.updateMany).toHaveBeenCalledWith({
      where: { id: "fact-1", organizationId: "org-a", deletedAt: null },
      data: expect.objectContaining({ text: "" }),
    });
    const erased = db.memoryFact.updateMany.mock.calls[0]?.[0].data as { text: string; deletedAt: Date };
    expect(erased.text).toBe("");
    expect(erased.deletedAt).toBeInstanceOf(Date);

    db.memoryFact.updateMany.mockClear();
    await expect(forgetAllMemoryAction(form({ agente: "MARKETING" }))).rejects.toThrow(
      "REDIRECT:/panel/marketing?ok=memoria_todo",
    );
    expect(db.memoryFact.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-a",
        deletedAt: null,
        OR: [{ agent: "MARKETING" }, { agent: null }],
      },
      data: expect.objectContaining({ text: "" }),
    });
  });

  test("con el interruptor apagado el borrado no corre", async () => {
    await expect(forgetMemoryAction(form({ agente: "ACCOUNTING", id: "fact-1" }))).rejects.toThrow(
      "REDIRECT:/panel/contador?error=datos",
    );
    expect(db.memoryFact.updateMany).not.toHaveBeenCalled();
  });
});
