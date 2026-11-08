import { chunkGapMs, streamWasStopped, isAbortError, waitChunk } from "@/lib/chat/abort";
import {
  accountantChatInstructions,
  APPROVED_PORTAL_NOTE,
  vaultContext,
} from "@/lib/chat/accountant";
import type { ChatClientEvent } from "@/lib/chat/public";
import type { PreparedFile } from "@/lib/chat/files";
import { lastUserText, prepareModelTurn, shouldAttachVaultNote } from "@/lib/chat/model-turn";
import { redactChatSecrets } from "@/lib/chat/secrets";
import { sensitiveRequest, splitAction, vaultActionFor, wantsSecureCredentialForm } from "@/lib/chat/sensitive";
import { missingVaultTable } from "@/lib/credentials/http";
import { clientAskedForLogin, explicitVaultAsk, metadataForModel } from "@/lib/credentials/policy";
import { portalPresetFromText, vaultFormMessage } from "@/lib/credentials/portal-form";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { confirmRisk, listCredentials } from "@/lib/credentials/service";
import {
  loadHistory,
  missingTable,
  saveAssistantMessage,
  saveConfirmation,
  saveCountedAssistantMessage,
  saveUserMessage,
  toPublic,
} from "@/lib/chat/store";
import { modelFor } from "@/lib/catalog";
import { logEvent } from "@/lib/log";
import { recordCompletedTask, recordModelCall } from "@/lib/meter-store";
import { USAGE_PRESETS } from "@/lib/pricing";
import { Prisma, prisma } from "@/lib/prisma";
import { reserveUsage, usedThisMonth } from "@/lib/usage-store";
import { xaiUsesNetwork, createXaiClient } from "@/lib/xai/client";
import type { XaiResponse } from "@/lib/xai/types";

const FAIL_TEXT = "No alcancé a responder. No descontamos esta vez.";
const CANCEL_TEXT = "Cancelado. No presento la declaración ni hago el pago.";
const APPROVED_NOTE = APPROVED_PORTAL_NOTE;

const messageInclude = {
  attachments: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.AgentMessageInclude;

function todayCl() {
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date());
}

function chatInstructions(organizationName: string) {
  return accountantChatInstructions(organizationName);
}

function asksVault(text: string) {
  return explicitVaultAsk(text) || clientAskedForLogin(text);
}

async function vaultPrompt(organizationId: string, texts: string[]) {
  if (!texts.some(asksVault)) return "";
  try {
    const rows = await listCredentials(prismaCredentialRepo(), organizationId);
    return vaultContext(metadataForModel(rows));
  } catch (error) {
    if (!missingVaultTable(error)) logEvent("chat.boveda", { organizationId });
    return "";
  }
}

async function recordVaultConfirmation(organizationId: string, actorUserId: string, action: string) {
  const vaultAction = vaultActionFor(action);
  if (!vaultAction) return;
  try {
    const result = await confirmRisk(prismaCredentialRepo(), {
      organizationId,
      actorUserId,
      action: vaultAction,
    });
    if (!result.ok) logEvent("chat.boveda_confirmacion", { organizationId, ok: false });
  } catch (error) {
    if (!missingVaultTable(error)) logEvent("chat.boveda_confirmacion", { organizationId, ok: false });
  }
}

async function* streamModel(input: {
  threadId: string;
  organizationId: string;
  organizationName: string;
  extra: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  const history = await loadHistory(input.threadId, input.organizationId);
  const latest = lastUserText(history);
  const vault = shouldAttachVaultNote(latest) ? await vaultPrompt(input.organizationId, [latest]) : "";
  const prepared = prepareModelTurn(history, vault);
  const extra = [prepared.vaultNote, input.extra].filter(Boolean).join("\n\n");
  const client = createXaiClient();
  let raw = "";
  let final: XaiResponse | null = null;
  const gap = chunkGapMs(xaiUsesNetwork());
  try {
    for await (const event of client.streamRespond({
      model: modelFor("ACCOUNTING"),
      instructions: [chatInstructions(input.organizationName), extra].filter(Boolean).join("\n\n"),
      task: { type: "agent_chat", today: todayCl(), messages: prepared.messages },
      usage: USAGE_PRESETS.text,
      businessName: input.organizationName,
      maxOutputTokens: 4000,
      signal: input.signal,
    })) {
      if (streamWasStopped(input.signal)) return;
      if (event.type === "status") yield { type: "status", text: event.text };
      if (event.type === "delta") {
        await waitChunk(input.signal, gap);
        // Stopping here skips reserveUsage below, so the consult is not billed.
        if (streamWasStopped(input.signal)) return;
        raw += event.text;
        yield { type: "delta", text: event.text };
      }
      if (event.type === "done") final = event.response;
    }
  } catch (error) {
    if (missingTable(error)) throw error;
    if (streamWasStopped(input.signal) || isAbortError(error)) return;
    logEvent("chat.ia", { organizationId: input.organizationId });
    const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
    yield { type: "message", message: fail };
    yield { type: "error", code: "ia" };
    return;
  }
  if (streamWasStopped(input.signal)) return;
  if (!final?.outputText.trim() && !raw.trim()) {
    const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
    yield { type: "message", message: fail };
    yield { type: "error", code: "ia" };
    return;
  }
  if (streamWasStopped(input.signal)) return;
  const response = final ?? {
    id: "resp_parcial",
    model: modelFor("ACCOUNTING"),
    outputText: raw,
    usage: USAGE_PRESETS.text,
    mocked: !xaiUsesNetwork(),
  };
  const split = splitAction(response.outputText || raw);
  await recordModelCall({ organizationId: input.organizationId, response });
  const saved = await prisma.$transaction(async (tx) => {
    const reserved = await reserveUsage(tx, {
      organizationId: input.organizationId,
      agent: "ACCOUNTING",
      metric: "CONSULTS",
      quantity: 1,
      tokens: response.usage,
      model: response.model,
    });
    if (!reserved.ok) return null;
    await recordCompletedTask(tx, {
      organizationId: input.organizationId,
      model: response.model,
      synthetic: response.mocked,
    });
    return tx.agentMessage.create({
      data: {
        threadId: input.threadId,
        role: "ASSISTANT",
        body: split.text || "No reemplaza a un contador certificado.",
      },
      include: messageInclude,
    });
  });
  if (!saved) {
    yield { type: "error", code: "limite" };
    return;
  }
  yield { type: "message", message: toPublic(saved) };
  if (split.action) {
    const card = await saveConfirmation(input.threadId, split.action);
    yield { type: "message", message: card };
  }
  yield { type: "usage", consults: await usedThisMonth(input.organizationId, "CONSULTS") };
  yield { type: "done" };
}

async function* streamVaultForm(input: {
  threadId: string;
  organizationId: string;
  text: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  yield { type: "status", text: "Te dejo el formulario…" };
  if (streamWasStopped(input.signal)) return;
  const body = vaultFormMessage(portalPresetFromText(input.text));
  const saved = await saveCountedAssistantMessage(input.organizationId, input.threadId, body);
  if (!saved) {
    yield { type: "error", code: "limite" };
    return;
  }
  yield { type: "message", message: saved };
  yield { type: "usage", consults: await usedThisMonth(input.organizationId, "CONSULTS") };
  yield { type: "done" };
}

export async function* streamChatTurn(input: {
  organizationId: string;
  organizationName: string;
  actorUserId: string;
  text: string;
  files: PreparedFile[];
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  const text = redactChatSecrets(input.text);
  const action = sensitiveRequest(text);
  const saved = await saveUserMessage({
    organizationId: input.organizationId,
    body: text,
    files: input.files,
  });
  yield { type: "user", message: saved.message };
  if (action) {
    const card = await saveConfirmation(saved.threadId, action);
    yield { type: "message", message: card };
    yield { type: "done" };
    return;
  }
  if (streamWasStopped(input.signal)) return;
  if (wantsSecureCredentialForm(text)) {
    yield* streamVaultForm({
      threadId: saved.threadId,
      organizationId: input.organizationId,
      text,
      signal: input.signal,
    });
    return;
  }
  yield { type: "status", text: "Revisando…" };
  if (input.files.length > 0) yield { type: "status", text: "Revisando el archivo…" };
  yield* streamModel({
    threadId: saved.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    extra: "",
    signal: input.signal,
  });
}

export async function* streamDecision(input: {
  organizationId: string;
  organizationName: string;
  actorUserId: string;
  messageId: string;
  decision: "APPROVED" | "CANCELED";
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  const current = await prisma.agentMessage.findFirst({
    where: {
      id: input.messageId,
      kind: "CONFIRMATION",
      thread: { organizationId: input.organizationId, agent: "ACCOUNTING" },
    },
  });
  if (!current || current.confirmation !== "PENDING") {
    yield { type: "error", code: "confirmacion" };
    return;
  }
  const changed = await prisma.agentMessage.updateMany({
    where: { id: current.id, confirmation: "PENDING" },
    data: { confirmation: input.decision },
  });
  if (changed.count !== 1) {
    yield { type: "error", code: "confirmacion" };
    return;
  }
  const updated = await prisma.agentMessage.findFirstOrThrow({
    where: { id: current.id },
    include: messageInclude,
  });
  yield { type: "replace", message: toPublic(updated) };
  if (input.decision === "CANCELED") {
    const note = await saveAssistantMessage(current.threadId, CANCEL_TEXT);
    yield { type: "message", message: note };
    yield { type: "done" };
    return;
  }
  yield { type: "status", text: "Revisando…" };
  await recordVaultConfirmation(input.organizationId, input.actorUserId, current.action);
  const files = await prisma.agentAttachment.count({
    where: { organizationId: input.organizationId, message: { threadId: current.threadId, role: "USER" } },
  });
  if (files > 0) yield { type: "status", text: "Revisando el archivo…" };
  if (streamWasStopped(input.signal)) return;
  yield* streamModel({
    threadId: current.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    extra: APPROVED_NOTE,
    signal: input.signal,
  });
}
