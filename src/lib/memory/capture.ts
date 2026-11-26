import type { ChatAgentId } from "@/lib/chat/agents";
import type { ChatClientEvent } from "@/lib/chat/public";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { scheduleAfterResponse } from "@/lib/memory/schedule";
import { rememberLatestChatTurn } from "@/lib/memory/service";

/** Agenda la extracción para cuando el stream ya cerró. Apagado, no hace nada. */
export async function* captureChatMemory(
  organizationId: string,
  agent: ChatAgentId,
  source: AsyncIterable<ChatClientEvent>,
): AsyncGenerator<ChatClientEvent> {
  let scheduled = false;
  for await (const event of source) {
    if (
      !scheduled &&
      memoryFeatureEnabled() &&
      event.type === "message" &&
      event.message.role === "ASSISTANT" &&
      event.message.kind === "TEXT"
    ) {
      scheduled = true;
      scheduleAfterResponse(() => rememberLatestChatTurn(organizationId, agent));
    }
    yield event;
  }
}
