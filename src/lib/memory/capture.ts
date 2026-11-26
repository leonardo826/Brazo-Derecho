import type { ChatAgentId } from "@/lib/chat/agents";
import type { ChatClientEvent } from "@/lib/chat/public";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { rememberLatestChatTurn } from "@/lib/memory/service";

/** Después del turno del asistente, guarda datos durables. Apagado, no hace nada. */
export async function* captureChatMemory(
  organizationId: string,
  agent: ChatAgentId,
  source: AsyncIterable<ChatClientEvent>,
): AsyncGenerator<ChatClientEvent> {
  let sawAssistant = false;
  for await (const event of source) {
    if (event.type === "message" && event.message.role === "ASSISTANT" && event.message.kind === "TEXT") {
      sawAssistant = true;
    }
    yield event;
  }
  if (sawAssistant && memoryFeatureEnabled()) await rememberLatestChatTurn(organizationId, agent);
}
