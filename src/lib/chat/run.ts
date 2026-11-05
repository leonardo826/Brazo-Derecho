import {
  accountantChatInstructions,
  APPROVED_PORTAL_NOTE,
  fillDoneMessage,
  fillFailedMessage,
  fillNeedsConfirmationMessage,
  fillQueuedMessage,
  fillUnavailableMessage,
  planPortalAccess,
  vaultContext,
  vaultScreenMessage,
} from "@/lib/chat/accountant";
import type { ChatClientEvent } from "@/lib/chat/public";
import type { PreparedFile } from "@/lib/chat/files";
import { sensitiveRequest, splitAction, vaultActionFor, wantsPortalAccess } from "@/lib/chat/sensitive";
import { enqueueComputerTask } from "@/lib/computer/orchestrator";
import { prismaComputerStore } from "@/lib/computer/store";
import { missingVaultTable } from "@/lib/credentials/http";
import { clientAskedForLogin, explicitVaultAsk, metadataForModel } from "@/lib/credentials/policy";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { confirmRisk, listCredentials, prepareCredentialUse } from "@/lib/credentials/service";
import type { CredentialMeta } from "@/lib/credentials/types";
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* streamModel(input: {
  threadId: string;
  organizationId: string;
  organizationName: string;
  extra: string;
}): AsyncGenerator<ChatClientEvent> {
  const turns = await loadHistory(input.threadId, input.organizationId);
  const vault = await vaultPrompt(
    input.organizationId,
    turns.filter((turn) => turn.role === "user").map((turn) => turn.text),
  );
  if (vault) {
    yield { type: "status", text: "Usando la bóveda…" };
    turns.push({ role: "user", text: vault });
  }
  if (input.extra) turns.push({ role: "user", text: input.extra });
  const client = createXaiClient();
  let raw = "";
  let final: XaiResponse | null = null;
  try {
    for await (const event of client.streamRespond({
      model: modelFor("ACCOUNTING"),
      instructions: chatInstructions(input.organizationName),
      task: { type: "agent_chat", today: todayCl(), messages: turns },
      usage: USAGE_PRESETS.text,
      businessName: input.organizationName,
      maxOutputTokens: 4000,
    })) {
      if (event.type === "status") yield { type: "status", text: event.text };
      if (event.type === "delta") {
        if (!xaiUsesNetwork() && process.env.VITEST !== "true") await delay(12);
        raw += event.text;
        yield { type: "delta", text: event.text };
      }
      if (event.type === "done") final = event.response;
    }
  } catch (error) {
    if (missingTable(error)) throw error;
    logEvent("chat.ia", { organizationId: input.organizationId });
    const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
    yield { type: "message", message: fail };
    yield { type: "error", code: "ia" };
    return;
  }
  if (!final?.outputText.trim() && !raw.trim()) {
    const fail = await saveAssistantMessage(input.threadId, FAIL_TEXT);
    yield { type: "message", message: fail };
    yield { type: "error", code: "ia" };
    return;
  }
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

function hideGrant(text: string, grant: string) {
  return grant ? text.split(grant).join("[redactado]") : text;
}

async function* streamPortalAccess(input: {
  threadId: string;
  organizationId: string;
  actorUserId: string;
  text: string;
}): AsyncGenerator<ChatClientEvent> {
  yield { type: "status", text: "Revisando la bóveda…" };
  let rows: CredentialMeta[] = [];
  try {
    rows = metadataForModel(await listCredentials(prismaCredentialRepo(), input.organizationId));
  } catch (error) {
    if (!missingVaultTable(error)) logEvent("chat.boveda", { organizationId: input.organizationId });
  }
  const plan = planPortalAccess(input.text, rows);
  let body = plan.message;
  if (plan.kind === "fill") {
    try {
      const prepared = await prepareCredentialUse(
        prismaCredentialRepo(),
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          goal: input.text,
          credentialId: plan.credential.id,
        },
        process.env,
      );
      if (!prepared.ok) {
        body = fillUnavailableMessage(plan.credential);
      } else if (!prepared.agentPayload) {
        body = fillUnavailableMessage(plan.credential);
      } else {
        const result = await enqueueComputerTask(
          {
            clientId: input.organizationId,
            goal: input.text,
            agentUrl: process.env.COMPUTER_AGENT_URL,
            agentToken: process.env.COMPUTER_AGENT_TOKEN,
            agentPayload: prepared.agentPayload,
          },
          { store: prismaComputerStore() },
        );
        const grant = prepared.agentPayload.fillGrant;
        if (!result.ok) body = hideGrant(fillFailedMessage(plan.credential), grant);
        else if (result.task.status === "DONE") body = hideGrant(fillDoneMessage(plan.credential), grant);
        else if (result.task.status === "QUEUED") body = hideGrant(fillQueuedMessage(plan.credential), grant);
        else if (result.task.status === "PENDING_APPROVAL") body = hideGrant(fillNeedsConfirmationMessage(plan.credential), grant);
        else body = hideGrant(fillFailedMessage(plan.credential), grant);
      }
    } catch (error) {
      if (!missingVaultTable(error)) logEvent("chat.boveda", { organizationId: input.organizationId });
      body = vaultScreenMessage(plan.credential.portal);
    }
  }
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
}): AsyncGenerator<ChatClientEvent> {
  const action = sensitiveRequest(input.text);
  const saved = await saveUserMessage({
    organizationId: input.organizationId,
    body: input.text,
    files: input.files,
  });
  yield { type: "user", message: saved.message };
  if (action) {
    const card = await saveConfirmation(saved.threadId, action);
    yield { type: "message", message: card };
    yield { type: "done" };
    return;
  }
  if (wantsPortalAccess(input.text)) {
    yield* streamPortalAccess({
      threadId: saved.threadId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      text: input.text,
    });
    return;
  }
  yield { type: "status", text: "Revisando…" };
  if (input.files.length > 0) yield { type: "status", text: "Revisando el archivo…" };
  if (asksVault(input.text)) yield { type: "status", text: "Usando la bóveda…" };
  yield* streamModel({
    threadId: saved.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    extra: "",
  });
}

export async function* streamDecision(input: {
  organizationId: string;
  organizationName: string;
  actorUserId: string;
  messageId: string;
  decision: "APPROVED" | "CANCELED";
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
  if (vaultActionFor(current.action) || asksVault(current.body)) yield { type: "status", text: "Usando la bóveda…" };
  await recordVaultConfirmation(input.organizationId, input.actorUserId, current.action);
  const files = await prisma.agentAttachment.count({
    where: { organizationId: input.organizationId, message: { threadId: current.threadId, role: "USER" } },
  });
  if (files > 0) yield { type: "status", text: "Revisando el archivo…" };
  yield* streamModel({
    threadId: current.threadId,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    extra: APPROVED_NOTE,
  });
}
