import { chunkGapMs, streamWasStopped, isAbortError, waitChunk } from "@/lib/chat/abort";
import { executeDesktopRequest } from "@/lib/chat/desktop-task";
import { CONTADOR_CONVERSATION_ID } from "@/lib/chat/composer-draft";
import { loadTenantLease } from "@/lib/computer/lease";
import { APPROVED_PORTAL_NOTE, vaultContext } from "@/lib/chat/accountant";
import { agentTurnContext } from "@/lib/chat/agent-context";
import { chatInstructions, chatSurface, outputBudget, type ChatAgentId } from "@/lib/chat/agents";
import type { ChatClientEvent } from "@/lib/chat/public";
import type { PreparedFile } from "@/lib/chat/files";
import { lastUserText, prepareModelTurn, shouldAttachVaultNote } from "@/lib/chat/model-turn";
import { carriesSuspectedSecret, SAFE_CREDENTIAL_ENTRY, shouldDropUserText } from "@/lib/chat/secrets";
import { sensitiveRequest, splitAction, vaultActionFor } from "@/lib/chat/sensitive";
import { missingVaultTable } from "@/lib/credentials/http";
import { clientAskedForLogin, explicitVaultAsk, metadataForModel } from "@/lib/credentials/policy";
import { portalPresetFromText, vaultFormMessage, type PortalId } from "@/lib/credentials/portal-form";
import { closeDeliverable, finishReply, LIMIT_NOTE, replyPace } from "@/lib/chat/pace";
import { randomBytes } from "node:crypto";
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
import { recordCompletedTask, recordModelCall, releaseDailyTask, reserveDailyTask } from "@/lib/meter-store";
import { addUsage, EMPTY_USAGE, USAGE_PRESETS, type TokenUsage } from "@/lib/pricing";
import { Prisma, prisma } from "@/lib/prisma";
import { reserveUsage, usedThisMonth } from "@/lib/usage-store";
import { xaiUsesNetwork, createXaiClient } from "@/lib/xai/client";

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

function mark(turn: string, stage: string, ms: number) {
  logEvent("chat.tiempo", { turn, stage, ms: Math.round(ms) });
}

async function* streamModel(input: {
  threadId: string;
  organizationId: string;
  organizationName: string;
  agent: ChatAgentId;
  extra: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  const turn = randomBytes(4).toString("hex");
  const started = performance.now();
  let reservationId: string | null = null;
  let keepSlot = false;
  try {
  if (streamWasStopped(input.signal)) return;
  const slotPromise = reserveDailyTask(input.organizationId);
  // Si la reserva rechaza mientras loadHistory sigue pendiente, el rechazo ya tiene manejador.
  void slotPromise.catch(() => undefined);
  let history;
  try {
    history = await loadHistory(input.threadId, input.organizationId, input.agent);
  } catch (error) {
    const slot = await slotPromise;
    if (slot.ok) reservationId = slot.reservationId;
    throw error;
  }
  const slot = await slotPromise;
  if (slot.ok) reservationId = slot.reservationId;
  mark(turn, "contexto_cupo", performance.now() - started);
  if (!slot.ok) {
    yield { type: "error", code: "limite" };
    return;
  }
  if (streamWasStopped(input.signal)) return;
  const latest = lastUserText(history);
  const vault = shouldAttachVaultNote(latest) ? await vaultPrompt(input.organizationId, [latest]) : "";
  const business = await agentTurnContext(input.agent, input.organizationId);
  const prepared = prepareModelTurn(history, vault);
  const extra = [business, prepared.vaultNote, input.extra].filter(Boolean).join("\n\n");
  const pace = outputBudget(input.agent, replyPace(latest));
  const client = createXaiClient();
  let raw = "";
  let incomplete = false;
  let cut: "limit" | "failure" = "limit";
  const billed: { id: string; model: string; usage: TokenUsage; mocked: boolean }[] = [];
  const gap = chunkGapMs(xaiUsesNetwork());
  const modelStarted = performance.now();
  let firstToken = 0;
  try {
    for (let round = 0; round < pace.rounds; round += 1) {
      if (streamWasStopped(input.signal)) return;
      const messages =
        round === 0
          ? prepared.messages
          : [
              ...prepared.messages,
              { role: "assistant" as const, text: raw },
              {
                role: "user" as const,
                text: "Sigue desde el último punto, sin repetir lo ya escrito, hasta terminar lo pedido.",
              },
            ];
      let roundText = "";
      incomplete = false;
      for await (const event of client.streamRespond({
        model: modelFor(input.agent),
        instructions: [chatInstructions(input.agent, input.organizationName), extra].filter(Boolean).join("\n\n"),
        task: { type: "agent_chat", today: todayCl(), messages },
        usage: USAGE_PRESETS.text,
        businessName: input.organizationName,
        maxOutputTokens: pace.maxOutputTokens,
        webSearch: pace.webSearch,
        reasoningEffort: pace.reasoningEffort,
        signal: input.signal,
      })) {
        if (streamWasStopped(input.signal)) return;
        if (event.type === "status") yield { type: "status", text: event.text };
        if (event.type === "delta") {
          if (firstToken === 0) {
            firstToken = performance.now() - modelStarted;
            mark(turn, "modelo_primer", firstToken);
          }
          await waitChunk(input.signal, gap);
          if (streamWasStopped(input.signal)) return;
          roundText += event.text;
          raw += event.text;
          yield { type: "delta", text: event.text };
        }
        if (event.type === "done") {
          incomplete = event.response.incomplete === true;
          const usage = event.response.usage ?? EMPTY_USAGE;
          const model = event.response.model.trim() || modelFor(input.agent);
          const responseId = event.response.id.trim().slice(0, 80) || "resp_sin_id";
          await recordModelCall({
            organizationId: input.organizationId,
            response: { model, usage, mocked: event.response.mocked },
          });
          billed.push({ id: responseId, model, usage, mocked: event.response.mocked });
          logEvent("chat.consumo", {
            turn,
            organizationId: input.organizationId,
            responseId,
            model,
            round,
            incomplete,
            inputTokens: usage.inputTokens,
            cachedTokens: usage.cachedTokens,
            outputTokens: usage.outputTokens,
            mocked: event.response.mocked,
          });
          if (!roundText.trim() && event.response.outputText.trim()) {
            roundText = event.response.outputText;
            raw += event.response.outputText;
            yield { type: "delta", text: event.response.outputText };
          }
        }
      }
      if (!incomplete) break;
    }
  } catch (error) {
    if (missingTable(error)) throw error;
    if (streamWasStopped(input.signal) || isAbortError(error)) return;
    logEvent("chat.ia", { organizationId: input.organizationId });
    if (!raw.trim()) {
      const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
      yield { type: "message", message: fail };
      yield { type: "error", code: "ia" };
      return;
    }
    cut = "failure";
  }
  if (streamWasStopped(input.signal)) return;
  const drafted = finishReply([{ text: raw, incomplete }], cut);
  const finished =
    input.agent === "MARKETING" && drafted.truncated && drafted.note === LIMIT_NOTE
      ? { ...drafted, text: closeDeliverable(drafted.text), note: "" }
      : drafted;
  if (!finished.text.trim()) {
    const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
    yield { type: "message", message: fail };
    yield { type: "error", code: "ia" };
    return;
  }
  if (finished.note) yield { type: "delta", text: `\n\n${finished.note}` };
  if (streamWasStopped(input.signal)) return;
  const usage = billed.reduce((sum, round) => addUsage(sum, round.usage), EMPTY_USAGE);
  const last = billed[billed.length - 1];
  const split = splitAction(finished.text);
  // CHAT ya guardó los tokens de cada tramo, también de un corte o de un tramo anterior a un fallo.
  // CONSULTS cuenta una consulta del mes solo si quedó texto útil. TASK solo si la respuesta terminó.
  const saved = await prisma.$transaction(async (tx) => {
    const surface = chatSurface(input.agent);
    const reserved = await reserveUsage(tx, {
      organizationId: input.organizationId,
      agent: input.agent,
      metric: surface.metric,
      quantity: 1,
      tokens: usage,
      model: last?.model ?? modelFor(input.agent),
    });
    if (!reserved.ok) return null;
    if (!finished.truncated) {
      await recordCompletedTask(tx, {
        organizationId: input.organizationId,
        model: last?.model ?? modelFor(input.agent),
        synthetic: last?.mocked ?? !xaiUsesNetwork(),
        reservationId,
      });
    }
    return tx.agentMessage.create({
      data: {
        threadId: input.threadId,
        role: "ASSISTANT",
        body: split.text || (input.agent === "ACCOUNTING" ? "No reemplaza a un contador certificado." : "No alcancé a dejar la respuesta."),
      },
      include: messageInclude,
    });
  });
  if (!saved) {
    yield { type: "error", code: "limite" };
    return;
  }
  if (!finished.truncated) keepSlot = true;
  yield { type: "message", message: toPublic(saved) };
  if (split.action) {
    const card = await saveConfirmation(input.threadId, split.action);
    yield { type: "message", message: card };
  }
  yield { type: "usage", consults: await usedThisMonth(input.organizationId, chatSurface(input.agent).metric) };
  yield { type: "done" };
  } finally {
    if (!keepSlot && reservationId) await releaseDailyTask(reservationId);
  }
}

async function* streamVaultForm(input: {
  threadId: string;
  organizationId: string;
  agent: ChatAgentId;
  portal: PortalId | null;
  source: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  if (streamWasStopped(input.signal)) return;
  const body = vaultFormMessage(input.portal, input.source);
  const saved = await saveCountedAssistantMessage(input.organizationId, input.threadId, body, input.agent);
  if (!saved) {
    yield { type: "error", code: "limite" };
    return;
  }
  yield { type: "message", message: saved };
  yield { type: "usage", consults: await usedThisMonth(input.organizationId, chatSurface(input.agent).metric) };
  yield { type: "done" };
}

export async function* streamChatTurn(input: {
  organizationId: string;
  organizationName: string;
  actorUserId: string;
  text: string;
  files: PreparedFile[];
  portal?: PortalId | null;
  agent?: ChatAgentId;
  signal?: AbortSignal;
}): AsyncGenerator<ChatClientEvent> {
  const agent = input.agent ?? "ACCOUNTING";
  const original = input.text;
  const drop = shouldDropUserText(original);
  const text = drop ? SAFE_CREDENTIAL_ENTRY : original;
  const hinted = input.portal ?? null;
  const portal = portalPresetFromText(original) ?? hinted;
  const saved = await saveUserMessage({
    organizationId: input.organizationId,
    body: text,
    agent,
    // Intención de formulario, sin secreto: se responde el formulario y se conservan los archivos.
    files: carriesSuspectedSecret(original) ? [] : input.files,
  });
  yield { type: "user", message: saved.message };
  if (drop || (hinted && text === SAFE_CREDENTIAL_ENTRY)) {
    if (streamWasStopped(input.signal)) return;
    yield* streamVaultForm({
      threadId: saved.threadId,
      organizationId: input.organizationId,
      agent,
      portal,
      source: original,
      signal: input.signal,
    });
    return;
  }
  const action = sensitiveRequest(text);
  if (action) {
    const card = await saveConfirmation(saved.threadId, action);
    yield { type: "message", message: card };
    yield { type: "done" };
    return;
  }
  const desktop = agent === "ACCOUNTING" ? await executeDesktopRequest({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    conversationId: CONTADOR_CONVERSATION_ID,
    text,
    signal: input.signal,
    loadLease: (organizationId) => loadTenantLease(organizationId),
    reserve: () => reserveDailyTask(input.organizationId),
    release: (reservationId) => releaseDailyTask(reservationId),
    log: (fields) => logEvent("chat.computador", fields),
  }) : { kind: "chat" as const };
  if (desktop.kind === "confirm") {
    const card = await saveConfirmation(saved.threadId, {
      id: "herramienta",
      title: "Confirmar antes de seguir",
      detail: text.replace(/\s+/g, " ").trim().slice(0, 500),
    });
    yield { type: "message", message: card };
    yield { type: "done" };
    return;
  }
  if (desktop.kind === "reply") {
    if (streamWasStopped(input.signal)) return;
    const message = await saveCountedAssistantMessage(input.organizationId, saved.threadId, desktop.text, agent);
    if (!message) {
      yield { type: "error", code: "limite" };
      return;
    }
    yield { type: "message", message };
    yield { type: "usage", consults: await usedThisMonth(input.organizationId, chatSurface(agent).metric) };
    yield { type: "done" };
    return;
  }
  if (streamWasStopped(input.signal)) return;
  if (input.files.length > 0) yield { type: "status", text: "Leyendo el archivo…" };
  yield* streamModel({
    threadId: saved.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    agent,
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
      thread: { organizationId: input.organizationId, agent: { in: ["ACCOUNTING", "MARKETING", "WHATSAPP"] } },
    },
    include: { thread: { select: { agent: true } } },
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
  await recordVaultConfirmation(input.organizationId, input.actorUserId, current.action);
  const files = await prisma.agentAttachment.count({
    where: { organizationId: input.organizationId, message: { threadId: current.threadId, role: "USER" } },
  });
  if (files > 0) yield { type: "status", text: "Leyendo el archivo…" };
  if (streamWasStopped(input.signal)) return;
  const agent = isDecisionAgent(current.thread.agent) ? current.thread.agent : "ACCOUNTING";
  yield* streamModel({
    threadId: current.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    agent,
    extra: APPROVED_NOTE,
    signal: input.signal,
  });
}

function isDecisionAgent(agent: string): agent is ChatAgentId {
  return agent === "ACCOUNTING" || agent === "MARKETING" || agent === "WHATSAPP";
}
