import { Prisma } from "@prisma/client";
import { withAssistantDisclosure } from "@/lib/agents/whatsapp";
import { decideWhatsappReply } from "@/lib/agents/whatsapp";
import { instructionsFor, limitFor, modelFor } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import { agentIsOpen } from "@/lib/agent-access";
import { dayStart, evaluateLimit } from "@/lib/usage";
import { reserveUsage, usedThisMonth } from "@/lib/usage-store";
import { createXaiClient } from "@/lib/xai/client";

export async function runWhatsappTurn(input: {
  organizationId: string;
  organizationName: string;
  conversationId: string;
  question: string;
  inboundExternalId?: string;
  now?: Date;
}) {
  if (input.inboundExternalId) {
    const duplicate = await prisma.message.findUnique({ where: { externalId: input.inboundExternalId } });
    if (duplicate) return { ok: true as const, duplicate: true as const, text: "" };
  }

  const access = await agentIsOpen(input.organizationId, "WHATSAPP", input.now);
  if (!access.open) return { ok: false as const, reason: "suscripcion" as const };

  const used = await usedThisMonth(input.organizationId, "RESPONSES", input.now);
  const room = evaluateLimit(used, 1, limitFor("WHATSAPP", "RESPONSES"));
  if (!room.ok) return { ok: false as const, reason: "limite" as const };

  const knowledge = await prisma.knowledgeItem.findMany({ where: { organizationId: input.organizationId } });
  const decision = decideWhatsappReply(input.question, knowledge);
  const task =
    decision.kind === "refuse"
      ? { type: "whatsapp_refuse" as const, reply: decision.reply }
      : decision.kind === "answer"
        ? { type: "whatsapp_answer" as const, title: decision.item.title, body: decision.item.body }
        : { type: "whatsapp_escalate" as const };

  const since = dayStart(input.now);
  const priorToday = await prisma.message.count({
    where: { conversationId: input.conversationId, role: "AGENT", createdAt: { gte: since } },
  });

  let response;
  try {
    response = await createXaiClient().respond({
      model: modelFor("WHATSAPP"),
      instructions: instructionsFor("WHATSAPP", input.organizationName),
      task,
      usage: USAGE_PRESETS.whatsapp,
      businessName: input.organizationName,
      maxOutputTokens: 500,
    });
  } catch {
    return { ok: false as const, reason: "ia" as const };
  }

  const text = withAssistantDisclosure(response.outputText, input.organizationName, priorToday === 0);
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const usage = await reserveUsage(tx, {
        organizationId: input.organizationId,
        agent: "WHATSAPP",
        metric: "RESPONSES",
        quantity: 1,
        tokens: response.usage,
        model: response.model,
        now: input.now,
      });
      if (!usage.ok) return usage;
      await tx.message.create({
        data: {
          conversationId: input.conversationId,
          role: "CUSTOMER",
          body: input.question,
          externalId: input.inboundExternalId,
        },
      });
      await tx.message.create({
        data: {
          conversationId: input.conversationId,
          role: "AGENT",
          body: text,
          escalated: decision.kind === "escalate",
          refused: decision.kind === "refuse",
        },
      });
      return { ok: true as const };
    });
    if (!saved.ok) return { ok: false as const, reason: "limite" as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true as const, duplicate: true as const, text: "" };
    }
    throw error;
  }

  return {
    ok: true as const,
    duplicate: false as const,
    text,
    escalated: decision.kind === "escalate",
    refused: decision.kind === "refuse",
  };
}
