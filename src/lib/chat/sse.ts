import type { ChatClientEvent } from "@/lib/chat/public";
import { missingTable } from "@/lib/chat/store";

export function sseResponse(events: AsyncIterable<ChatClientEvent>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatClientEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of events) send(event);
      } catch (error) {
        send({ type: "error", code: missingTable(error) ? "migracion" : "ia" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
