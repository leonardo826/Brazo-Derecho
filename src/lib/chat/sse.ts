import { isAbortError, streamWasStopped } from "@/lib/chat/abort";
import type { ChatClientEvent } from "@/lib/chat/public";
import { missingTable } from "@/lib/chat/store";

export async function forwardEvents(
  events: AsyncIterable<ChatClientEvent>,
  signal: AbortSignal | undefined,
  send: (event: ChatClientEvent) => void | boolean,
) {
  try {
    for await (const event of events) {
      if (streamWasStopped(signal)) return "abort" as const;
      if (send(event) === false) return "abort" as const;
    }
  } catch (error) {
    if (streamWasStopped(signal) || isAbortError(error)) return "abort" as const;
    send({ type: "error", code: missingTable(error) ? "migracion" : "ia" });
    return "error" as const;
  }
  return streamWasStopped(signal) ? ("abort" as const) : ("done" as const);
}

export function sseResponse(
  create: (signal: AbortSignal) => AsyncIterable<ChatClientEvent>,
  parent?: AbortSignal,
) {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (parent?.aborted) stop();
  else parent?.addEventListener("abort", stop, { once: true });
  const events = create(controller.signal);
  const stream = new ReadableStream({
    async start(streamController) {
      let open = true;
      const send = (event: ChatClientEvent) => {
        if (!open || streamWasStopped(controller.signal)) return false;
        try {
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          return true;
        } catch {
          open = false;
          stop();
          return false;
        }
      };
      try {
        await forwardEvents(events, controller.signal, send);
      } finally {
        parent?.removeEventListener("abort", stop);
        open = false;
        try {
          streamController.close();
        } catch {
          // The client already closed the stream.
        }
      }
    },
    cancel() {
      stop();
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
