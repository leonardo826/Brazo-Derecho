"use server";

import { redirect } from "next/navigation";
import { AGENT_CATALOG } from "@/lib/catalog";
import { agentIsOpen } from "@/lib/agent-access";
import { decideWhatsappReply } from "@/lib/agents/whatsapp";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { reserveUsage } from "@/lib/usage-store";
import { conversationSchema, knowledgeSchema, messageSchema } from "@/lib/validation";
import { createXaiClient } from "@/lib/xai/client";

function backTo(conversationId?: string, notice?: { error?: string; ok?: string }) {
  const params = new URLSearchParams();
  if (conversationId) params.set("c", conversationId);
  if (notice?.error) params.set("error", notice.error);
  if (notice?.ok) params.set("ok", notice.ok);
  const query = params.toString();
  return query ? `/panel/whatsapp?${query}` : "/panel/whatsapp";
}

export async function createKnowledgeAction(formData: FormData) {
  const session = await requireSession();
  const parsed = knowledgeSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) redirect(backTo(undefined, { error: "conocimiento" }));
  const count = await prisma.knowledgeItem.count({ where: { organizationId: session.organizationId } });
  if (count >= 200) redirect(backTo(undefined, { error: "cupo" }));
  await prisma.knowledgeItem.create({
    data: {
      organizationId: session.organizationId,
      title: parsed.data.title,
      body: parsed.data.body,
    },
  });
  redirect(backTo(undefined, { ok: "conocimiento" }));
}

export async function deleteKnowledgeAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const deleted = await prisma.knowledgeItem.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  redirect(backTo(undefined, deleted.count === 1 ? { ok: "eliminado" } : { error: "noencontrado" }));
}

export async function startConversationAction(formData: FormData) {
  const session = await requireSession();
  const parsed = conversationSchema.safeParse({ customerLabel: formData.get("customerLabel") });
  if (!parsed.success) redirect(backTo(undefined, { error: "datos" }));
  if (!(await agentIsOpen(session.organizationId, "WHATSAPP")).open) {
    redirect(backTo(undefined, { error: "suscripcion" }));
  }
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: session.organizationId,
      customerLabel: parsed.data.customerLabel,
    },
  });
  redirect(backTo(conversation.id, { ok: "hilo" }));
}

export async function sendCustomerMessageAction(formData: FormData) {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  const parsed = messageSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) redirect(backTo(conversationId, { error: "datos" }));
  if (!(await agentIsOpen(session.organizationId, "WHATSAPP")).open) {
    redirect(backTo(conversationId, { error: "suscripcion" }));
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId },
  });
  if (!conversation) redirect(backTo(undefined, { error: "noencontrado" }));

  const knowledge = await prisma.knowledgeItem.findMany({
    where: { organizationId: session.organizationId },
  });
  const decision = decideWhatsappReply(parsed.data.body, knowledge);
  const task =
    decision.kind === "refuse"
      ? { type: "whatsapp_refuse" as const, reply: decision.reply }
      : decision.kind === "answer"
        ? { type: "whatsapp_answer" as const, title: decision.item.title, body: decision.item.body }
        : { type: "whatsapp_escalate" as const };

  const response = await createXaiClient().respond({
    model: AGENT_CATALOG.WHATSAPP.model,
    instructions: AGENT_CATALOG.WHATSAPP.instructions,
    task,
    usage: USAGE_PRESETS.whatsapp,
  });

  const saved = await prisma.$transaction(async (tx) => {
    const usage = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "WHATSAPP",
      metric: "RESPONSES",
      quantity: 1,
      tokens: response.usage,
    });
    if (!usage.ok) return usage;
    await tx.message.create({
      data: { conversationId, role: "CUSTOMER", body: parsed.data.body },
    });
    await tx.message.create({
      data: {
        conversationId,
        role: "AGENT",
        body: response.outputText,
        escalated: decision.kind === "escalate",
        refused: decision.kind === "refuse",
      },
    });
    return { ok: true as const };
  });

  if (!saved.ok) redirect(backTo(conversationId, { error: "limite" }));
  redirect(backTo(conversationId, { ok: "respuesta" }));
}

export async function sendHumanMessageAction(formData: FormData) {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  const parsed = messageSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) redirect(backTo(conversationId, { error: "datos" }));
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId },
  });
  if (!conversation) redirect(backTo(undefined, { error: "noencontrado" }));
  await prisma.message.create({
    data: { conversationId, role: "HUMAN", body: parsed.data.body },
  });
  redirect(backTo(conversationId, { ok: "persona" }));
}
