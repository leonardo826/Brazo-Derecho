import type { ChatAgentId } from "@/lib/chat/agents";
import type { PublicMessage } from "@/lib/chat/public";
import { imageDataUrl, textExcerpt, type PreparedFile } from "@/lib/chat/files";
import { chronological, historyWhere, MODEL_HISTORY_LIMIT, NEWEST_FIRST, THREAD_VIEW_LIMIT } from "@/lib/chat/history";
import type { SensitiveAction } from "@/lib/chat/sensitive";
import { Prisma, prisma } from "@/lib/prisma";
import { reserveUsage } from "@/lib/usage-store";
import type { ChatFileInput } from "@/lib/xai/types";

const messageInclude = {
  attachments: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.AgentMessageInclude;

type StoredMessage = Prisma.AgentMessageGetPayload<{ include: typeof messageInclude }>;

export function missingTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

export function toPublic(message: StoredMessage): PublicMessage {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    body: message.body,
    action: message.action,
    actionTitle: message.actionTitle,
    confirmation: message.confirmation,
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments,
  };
}

export async function ensureThread(organizationId: string, agent: ChatAgentId = "ACCOUNTING") {
  return prisma.agentThread.upsert({
    where: { organizationId_agent: { organizationId, agent } },
    create: { organizationId, agent },
    update: {},
  });
}

async function importLegacy(threadId: string, organizationId: string) {
  const count = await prisma.agentMessage.count({ where: { threadId } });
  if (count > 0) return;
  const consults = await prisma.accountingConsult.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  if (consults.length === 0) return;
  try {
    await prisma.$transaction(async (tx) => {
      const again = await tx.agentMessage.count({ where: { threadId } });
      if (again > 0) return;
      for (const consult of consults) {
        await tx.agentMessage.create({
          data: {
            threadId,
            role: "USER",
            body: consult.question,
            legacyConsultId: consult.id,
            createdAt: consult.createdAt,
          },
        });
        await tx.agentMessage.create({
          data: {
            threadId,
            role: "ASSISTANT",
            body: consult.answer,
            createdAt: new Date(consult.createdAt.getTime() + 1),
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

export async function loadAgentThread(organizationId: string, agent: ChatAgentId = "ACCOUNTING") {
  const thread = await ensureThread(organizationId, agent);
  if (agent === "ACCOUNTING") await importLegacy(thread.id, organizationId);
  const messages = await prisma.agentMessage.findMany({
    where: { threadId: thread.id, thread: { organizationId } },
    orderBy: NEWEST_FIRST,
    take: THREAD_VIEW_LIMIT,
    include: messageInclude,
  });
  return chronological(messages).map(toPublic);
}

export async function saveUserMessage(input: {
  organizationId: string;
  body: string;
  files: PreparedFile[];
  agent?: ChatAgentId;
}) {
  const thread = await ensureThread(input.organizationId, input.agent ?? "ACCOUNTING");
  const message = await prisma.agentMessage.create({
    data: {
      threadId: thread.id,
      role: "USER",
      body: input.body,
      attachments: {
        create: input.files.map((file) => ({
          organizationId: input.organizationId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
          bytes: Buffer.from(file.bytes),
        })),
      },
    },
    include: messageInclude,
  });
  return { threadId: thread.id, message: toPublic(message) };
}

export async function saveAssistantMessage(threadId: string, body: string) {
  const message = await prisma.agentMessage.create({
    data: { threadId, role: "ASSISTANT", body },
    include: messageInclude,
  });
  return toPublic(message);
}

export async function saveCountedAssistantMessage(
  organizationId: string,
  threadId: string,
  body: string,
  agent: ChatAgentId = "ACCOUNTING",
) {
  const metric = agent === "MARKETING" ? "TEXTS" : agent === "WHATSAPP" ? "RESPONSES" : "CONSULTS";
  const saved = await prisma.$transaction(async (tx) => {
    const reserved = await reserveUsage(tx, {
      organizationId,
      agent,
      metric,
      quantity: 1,
    });
    if (!reserved.ok) return null;
    return tx.agentMessage.create({
      data: { threadId, role: "ASSISTANT", body },
      include: messageInclude,
    });
  });
  return saved ? toPublic(saved) : null;
}

export async function saveConfirmation(threadId: string, action: SensitiveAction) {
  const message = await prisma.agentMessage.create({
    data: {
      threadId,
      role: "ASSISTANT",
      kind: "CONFIRMATION",
      action: action.id,
      actionTitle: action.title,
      body: action.detail,
      confirmation: "PENDING",
    },
    include: messageInclude,
  });
  return toPublic(message);
}

export async function filesForModel(messageId: string, organizationId: string): Promise<ChatFileInput[]> {
  const rows = await prisma.agentAttachment.findMany({ where: { messageId, organizationId } });
  return rows.map((row) => {
    const prepared: PreparedFile = {
      fileName: row.fileName,
      mimeType: row.mimeType,
      bytes: new Uint8Array(row.bytes),
    };
    const image = imageDataUrl(prepared);
    if (image) return { name: row.fileName, mime: row.mimeType, imageDataUrl: image };
    const excerpt = textExcerpt(prepared);
    return {
      name: row.fileName,
      mime: row.mimeType,
      note: excerpt
        ? `Archivo adjunto «${row.fileName}»:\n${excerpt}`
        : `Archivo adjunto: ${row.fileName} (${row.mimeType}).`,
    };
  });
}

export async function loadHistory(threadId: string, organizationId: string, agent: ChatAgentId = "ACCOUNTING") {
  const rows = chronological(
    await prisma.agentMessage.findMany({
      where: historyWhere(threadId, organizationId, agent),
      orderBy: NEWEST_FIRST,
      take: MODEL_HISTORY_LIMIT,
      include: { attachments: { select: { fileName: true, mimeType: true } } },
    }),
  );
  let lastUserId = "";
  for (const row of rows) {
    if (row.role === "USER") lastUserId = row.id;
  }
  const messages: { role: "user" | "assistant"; text: string; files?: ChatFileInput[] }[] = [];
  for (const row of rows) {
    if (row.kind === "CONFIRMATION") {
      const state = row.confirmation === "APPROVED" ? "aprobada" : row.confirmation === "CANCELED" ? "cancelada" : "pendiente";
      messages.push({ role: "assistant", text: `Confirmación ${state}: ${row.actionTitle}. ${row.body}` });
      continue;
    }
    const files =
      row.id === lastUserId && row.attachments.length > 0
        ? await filesForModel(row.id, organizationId)
        : row.attachments.map((file) => ({
            name: file.fileName,
            mime: file.mimeType,
            note: `Archivo adjunto: ${file.fileName}.`,
          }));
    messages.push({
      role: row.role === "USER" ? "user" : "assistant",
      text: row.body,
      files: files.length ? files : undefined,
    });
  }
  return messages;
}
