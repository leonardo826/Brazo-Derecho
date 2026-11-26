import { marketingContext, whatsappContext, type ChatAgentId } from "@/lib/chat/agents";
import { missingTable } from "@/lib/chat/store";
import { logEvent } from "@/lib/log";
import { memoryForChat } from "@/lib/memory/service";
import { prisma } from "@/lib/prisma";

export async function agentTurnContext(agent: ChatAgentId, organizationId: string) {
  const business = await businessContext(agent, organizationId);
  const memory = await memoryForChat(organizationId, agent);
  if (!memory) return business;
  return business ? `${business}\n\n${memory}` : memory;
}

async function businessContext(agent: ChatAgentId, organizationId: string) {
  try {
    if (agent === "MARKETING") {
      const [organization, profile] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
        prisma.brandProfile.findUnique({ where: { organizationId } }),
      ]);
      return marketingContext({ name: organization?.name ?? "", profile });
    }
    if (agent === "WHATSAPP") {
      const [organization, knowledge] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, rut: true } }),
        prisma.knowledgeItem.findMany({
          where: { organizationId },
          orderBy: { title: "asc" },
          select: { title: true, body: true },
        }),
      ]);
      return whatsappContext({ name: organization?.name ?? "", rut: organization?.rut ?? null, knowledge });
    }
  } catch (error) {
    if (!missingTable(error)) logEvent("chat.contexto", { organizationId, agent });
  }
  return "";
}
