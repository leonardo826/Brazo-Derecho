import type { ChatAgentId } from "@/lib/chat/agents";
import { missingTable } from "@/lib/chat/store";
import { routineModel } from "@/lib/catalog";
import { logEvent } from "@/lib/log";
import { recordModelCall } from "@/lib/meter-store";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { redactForExtraction } from "@/lib/memory/filter";
import {
  erasedFactData,
  formatMemoryContext,
  parseMemoryPayload,
  planMemoryWrites,
  selectFactsForPrompt,
  type FactPlan,
  type StoredFact,
} from "@/lib/memory/facts";
import { Prisma, prisma, type AgentKind } from "@/lib/prisma";
import type { TokenUsage } from "@/lib/pricing";
import { createXaiClient } from "@/lib/xai/client";

export const MEMORY_INSTRUCTIONS = [
  "Eres un extractor de memoria para una pyme chilena.",
  "Lees un turno y devuelves únicamente JSON, sin markdown.",
  "Extrae solo datos durables de la empresa: nombre o razón social, RUT, rubro, productos, preferencias y tono.",
  "Un dato durable sirve en conversaciones futuras.",
  "No extraigas un pedido de un solo día, el precio de una cotización ni datos de un cliente final (teléfono, dirección particular o el nombre de quien escribió por WhatsApp).",
  "No extraigas contraseñas, claves, PIN, números de tarjeta, CVV, tokens ni llaves de API. Si el turno trae un secreto, omítelo.",
  "No repitas un hecho que ya esté guardado.",
  "Cada hecho es una frase corta en español de Chile, de hasta 180 caracteres.",
  'alcance "empresa" si el dato sirve a todos los agentes (nombre, RUT, rubro, productos). alcance "agente" si es el tono o una preferencia de este agente.',
  'Si no hay nada nuevo, responde {"hechos":[]}.',
  'Forma: {"hechos":[{"texto":"...","alcance":"empresa"}]}',
].join(" ");

const MEMORY_USAGE: TokenUsage = { inputTokens: 500, cachedTokens: 0, outputTokens: 120 };

type ExtractedCall = {
  raw: string;
  meter: { model: string; usage: TokenUsage; mocked: boolean } | null;
};

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max);
}

export function extractionInput(input: {
  agent: AgentKind;
  userText: string;
  assistantText: string;
  known: string[];
}) {
  const known = input.known
    .map((fact) => fact.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((fact) => `- ${fact}`)
    .join("\n");
  return [
    `Agente: ${input.agent}`,
    "Hechos ya guardados:",
    known || "(ninguno)",
    "Turno del cliente:",
    clip(redactForExtraction(input.userText), 2500) || "(vacío)",
    "Respuesta del asistente:",
    clip(redactForExtraction(input.assistantText), 2500) || "(vacío)",
  ].join("\n");
}

async function callExtractor(input: {
  agent: AgentKind;
  userText: string;
  assistantText: string;
  known: string[];
  complete?: (request: { instructions: string; input: string }) => Promise<string>;
}): Promise<ExtractedCall> {
  const turn = extractionInput(input);
  if (input.complete) {
    return { raw: await input.complete({ instructions: MEMORY_INSTRUCTIONS, input: turn }), meter: null };
  }
  const response = await createXaiClient().respond({
    model: routineModel(),
    instructions: MEMORY_INSTRUCTIONS,
    task: { type: "memory_extract", turn },
    usage: MEMORY_USAGE,
    maxOutputTokens: 400,
    webSearch: false,
    reasoningEffort: "low",
    signal: AbortSignal.timeout(15_000),
  });
  return {
    raw: response.outputText,
    meter: { model: response.model, usage: response.usage, mocked: response.mocked },
  };
}

async function persistPlan(organizationId: string, plan: FactPlan) {
  if (plan.inserts.length === 0 && plan.replacements.length === 0) return 0;
  let saved = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of plan.inserts) {
      try {
        await tx.memoryFact.create({ data: row });
        saved += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
        throw error;
      }
    }
    for (const row of plan.replacements) {
      const updated = await tx.memoryFact.updateMany({
        where: { id: row.id, organizationId, deletedAt: null },
        data: { text: row.text, contentHash: row.contentHash },
      });
      saved += updated.count;
    }
  });
  return saved;
}

export async function rememberTurn(input: {
  organizationId: string;
  agent: AgentKind;
  sourceConversationId: string | null;
  userText: string;
  assistantText: string;
  complete?: (request: { instructions: string; input: string }) => Promise<string>;
}) {
  if (!memoryFeatureEnabled()) return { saved: 0 };
  if (!input.userText.trim() && !input.assistantText.trim()) return { saved: 0 };
  try {
    const rows = await prisma.memoryFact.findMany({
      where: { organizationId: input.organizationId },
      select: { id: true, text: true, contentHash: true, deletedAt: true },
    });
    const existing: StoredFact[] = rows;
    const known = existing.filter((row) => row.deletedAt === null && row.text.trim()).map((row) => row.text);
    const extracted = await callExtractor({
      agent: input.agent,
      userText: input.userText,
      assistantText: input.assistantText,
      known,
      complete: input.complete,
    });
    if (extracted.meter) {
      try {
        await recordModelCall({ organizationId: input.organizationId, response: extracted.meter });
      } catch (error) {
        if (!missingTable(error)) logEvent("memoria.consumo", { organizationId: input.organizationId, ok: false });
      }
    }
    const plan = planMemoryWrites({
      existing,
      candidates: parseMemoryPayload(extracted.raw),
      agent: input.agent,
      organizationId: input.organizationId,
      sourceConversationId: input.sourceConversationId,
    });
    const saved = await persistPlan(input.organizationId, plan);
    return { saved };
  } catch (error) {
    if (!missingTable(error)) logEvent("memoria.extraccion", { organizationId: input.organizationId, agent: input.agent, ok: false });
    return { saved: 0 };
  }
}

export async function memoryPrompt(input: { organizationId: string; agent: AgentKind; query: string }) {
  if (!memoryFeatureEnabled()) return "";
  try {
    const rows = await prisma.memoryFact.findMany({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        text: { not: "" },
        OR: [{ agent: input.agent }, { agent: null }],
      },
      orderBy: { updatedAt: "desc" },
      take: 80,
      select: { id: true, text: true, agent: true, updatedAt: true },
    });
    return formatMemoryContext(selectFactsForPrompt(rows, input.query));
  } catch (error) {
    if (!missingTable(error)) logEvent("memoria.contexto", { organizationId: input.organizationId, agent: input.agent });
    return "";
  }
}

async function latestUserText(organizationId: string, agent: ChatAgentId) {
  const thread = await prisma.agentThread.findUnique({
    where: { organizationId_agent: { organizationId, agent } },
    select: { id: true },
  });
  if (!thread) return "";
  const message = await prisma.agentMessage.findFirst({
    where: { threadId: thread.id, role: "USER", kind: "TEXT" },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  return message?.body ?? "";
}

/** Texto que el chat del panel ya inyecta en las instrucciones. Apagado, no consulta la base. */
export async function memoryForChat(organizationId: string, agent: ChatAgentId) {
  if (!memoryFeatureEnabled()) return "";
  try {
    const query = await latestUserText(organizationId, agent);
    return await memoryPrompt({ organizationId, agent, query });
  } catch (error) {
    if (!missingTable(error)) logEvent("memoria.contexto", { organizationId, agent });
    return "";
  }
}

const SKIP_ASSISTANT = [/^No alcancé a responder\./, /^Cancelado\. No presento la declaración/];

export async function rememberLatestChatTurn(organizationId: string, agent: ChatAgentId) {
  if (!memoryFeatureEnabled()) return;
  try {
    const thread = await prisma.agentThread.findUnique({
      where: { organizationId_agent: { organizationId, agent } },
      select: { id: true },
    });
    if (!thread) return;
    const messages = await prisma.agentMessage.findMany({
      where: { threadId: thread.id, kind: "TEXT" },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { role: true, body: true, createdAt: true },
    });
    const assistant = messages.find((message) => message.role === "ASSISTANT");
    if (!assistant) return;
    if (Date.now() - assistant.createdAt.getTime() > 3 * 60 * 1000) return;
    if (SKIP_ASSISTANT.some((pattern) => pattern.test(assistant.body.trim()))) return;
    const user = messages.find((message) => message.role === "USER" && message.createdAt <= assistant.createdAt);
    await rememberTurn({
      organizationId,
      agent,
      sourceConversationId: thread.id,
      userText: user?.body ?? "",
      assistantText: assistant.body,
    });
  } catch (error) {
    if (!missingTable(error)) logEvent("memoria.extraccion", { organizationId, agent, ok: false });
  }
}

export type MemoryListItem = {
  id: string;
  text: string;
  scope: "empresa" | "agente";
  createdAt: Date;
};

export async function listMemoryForAgent(organizationId: string, agent: AgentKind): Promise<MemoryListItem[]> {
  const rows = await prisma.memoryFact.findMany({
    where: {
      organizationId,
      deletedAt: null,
      text: { not: "" },
      OR: [{ agent }, { agent: null }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, text: true, agent: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    scope: row.agent === null ? "empresa" : "agente",
    createdAt: row.createdAt,
  }));
}

export async function eraseMemoryFact(organizationId: string, id: string) {
  const now = new Date();
  return prisma.memoryFact.updateMany({
    where: { id, organizationId, deletedAt: null },
    data: erasedFactData(now),
  });
}

export async function eraseAgentMemory(organizationId: string, agent: AgentKind) {
  const now = new Date();
  return prisma.memoryFact.updateMany({
    where: {
      organizationId,
      deletedAt: null,
      OR: [{ agent }, { agent: null }],
    },
    data: erasedFactData(now),
  });
}
