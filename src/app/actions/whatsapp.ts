"use server";

import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { runWhatsappTurn } from "@/lib/agents/run-whatsapp";
import { assertOwnOrganizationActive, guardMutation, guardRate } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { conversationSchema, knowledgeSchema, messageSchema, recordIdSchema } from "@/lib/validation";
import { sendWhatsappText } from "@/lib/whatsapp/send";

function backTo(conversationId?: string, notice?: { error?: string; ok?: string }) {
  const params = new URLSearchParams();
  if (conversationId) params.set("c", conversationId);
  if (notice?.error) params.set("error", notice.error);
  if (notice?.ok) params.set("ok", notice.ok);
  const query = params.toString();
  return query ? `/panel/whatsapp?${query}` : "/panel/whatsapp";
}

export async function createKnowledgeAction(formData: FormData) {
  await guardMutation(formData, "/panel/whatsapp");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/whatsapp");
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
  await guardMutation(formData, "/panel/whatsapp");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/whatsapp");
  const parsedId = recordIdSchema.safeParse(formData.get("id"));
  if (!parsedId.success) redirect(backTo(undefined, { error: "datos" }));
  const id = parsedId.data;
  const deleted = await prisma.knowledgeItem.deleteMany({
    where: { id, organizationId: session.organizationId },
  });
  redirect(backTo(undefined, deleted.count === 1 ? { ok: "eliminado" } : { error: "noencontrado" }));
}

export async function startConversationAction(formData: FormData) {
  await guardMutation(formData, "/panel/whatsapp");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/whatsapp");
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
  const parsedConversation = recordIdSchema.safeParse(formData.get("conversationId"));
  const conversationId = parsedConversation.success ? parsedConversation.data : "";
  await guardMutation(formData, backTo(conversationId));
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, backTo(conversationId));
  guardRate(`chat:${session.organizationId}`, 30, 10 * 60 * 1000, backTo(conversationId));
  const parsed = messageSchema.safeParse({ body: formData.get("body") });
  if (!parsedConversation.success || !parsed.success) redirect(backTo(conversationId, { error: "datos" }));
  if (!(await agentIsOpen(session.organizationId, "WHATSAPP")).open) {
    redirect(backTo(conversationId, { error: "suscripcion" }));
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId },
  });
  if (!conversation) redirect(backTo(undefined, { error: "noencontrado" }));

  const turn = await runWhatsappTurn({
    organizationId: session.organizationId,
    organizationName: session.organizationName,
    conversationId,
    question: parsed.data.body,
  });
  if (!turn.ok) redirect(backTo(conversationId, { error: turn.reason === "ia" ? "ia" : turn.reason }));

  if (conversation.channel === "whatsapp" && conversation.externalId?.startsWith("wa:")) {
    const organization = await prisma.organization.findUnique({ where: { id: session.organizationId } });
    if (organization?.whatsappPhoneNumberId && turn.text) {
      const sent = await sendWhatsappText(
        organization.whatsappPhoneNumberId,
        conversation.externalId.slice(3),
        turn.text,
      );
      if (sent.sent) redirect(backTo(conversationId, { ok: "enviado" }));
    }
  }
  redirect(backTo(conversationId, { ok: "respuesta" }));
}

export async function sendHumanMessageAction(formData: FormData) {
  const parsedConversation = recordIdSchema.safeParse(formData.get("conversationId"));
  const conversationId = parsedConversation.success ? parsedConversation.data : "";
  await guardMutation(formData, backTo(conversationId));
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, backTo(conversationId));
  const parsed = messageSchema.safeParse({ body: formData.get("body") });
  if (!parsedConversation.success || !parsed.success) redirect(backTo(conversationId, { error: "datos" }));
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: session.organizationId },
  });
  if (!conversation) redirect(backTo(undefined, { error: "noencontrado" }));
  await prisma.message.create({
    data: { conversationId, role: "HUMAN", body: parsed.data.body },
  });
  if (conversation.channel === "whatsapp" && conversation.externalId?.startsWith("wa:")) {
    const organization = await prisma.organization.findUnique({ where: { id: session.organizationId } });
    if (organization?.whatsappPhoneNumberId) {
      const sent = await sendWhatsappText(
        organization.whatsappPhoneNumberId,
        conversation.externalId.slice(3),
        parsed.data.body,
      );
      if (sent.sent) redirect(backTo(conversationId, { ok: "enviado" }));
    }
  }
  redirect(backTo(conversationId, { ok: "persona" }));
}
