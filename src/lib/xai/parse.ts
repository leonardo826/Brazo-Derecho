import { composeAnswer, isImagePayload, type AnswerBody } from "@/lib/chat/answer";
import { readToolReport } from "@/lib/chat/tools";
import { EMPTY_USAGE, type TokenUsage } from "@/lib/pricing";
import type { XaiResponse, XaiStreamEvent } from "@/lib/xai/types";

export type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  server_side_tool_usage?: { web_search_calls?: number; x_search_calls?: number };
};

export type ResponsesBody = AnswerBody & {
  id?: string;
  model?: string;
  output?: Array<{
    type?: string;
    result?: string;
    content?: Array<{ type?: string; text?: string; annotations?: { type?: string; url?: string }[] }>;
  }>;
  usage?: ResponsesUsage;
  error?: { message?: string };
};

export function readTokenUsage(usage: ResponsesUsage | undefined): TokenUsage {
  const inputTokens = Math.max(0, Math.round(usage?.input_tokens ?? 0));
  const outputTokens = Math.max(0, Math.round(usage?.output_tokens ?? 0));
  const cachedRaw = Math.max(0, Math.round(usage?.input_tokens_details?.cached_tokens ?? 0));
  return {
    inputTokens,
    outputTokens,
    cachedTokens: Math.min(inputTokens, cachedRaw),
  };
}

export function readOutputText(body: ResponsesBody) {
  return composeAnswer(body);
}

export function mapXaiStreamEvent(raw: unknown): XaiStreamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as {
    type?: string;
    delta?: string;
    item?: { type?: string };
    response?: ResponsesBody;
  };
  const type = event.type ?? "";
  if (type === "response.output_text.delta" && typeof event.delta === "string" && event.delta) {
    if (isImagePayload(event.delta)) return { type: "status", text: "Preparando la imagen…", dropDraft: true };
    return { type: "delta", text: event.delta };
  }
  const itemType = event.item?.type ?? "";
  if (type.includes("image_generation") || itemType === "image_generation_call") {
    return { type: "status", text: "Preparando la imagen…", dropDraft: true };
  }
  if (type.includes("web_search") || itemType === "web_search_call" || itemType.includes("web_search") || itemType === "x_search_call") {
    return { type: "status", text: "Buscando en la web…", dropDraft: true };
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const body = event.response ?? (raw as ResponsesBody);
    const tools = readToolReport(body);
    return {
      type: "done",
      response: {
        id: body.id || "resp_sin_id",
        model: body.model || "",
        outputText: readOutputText(body),
        usage: readTokenUsage(body.usage),
        mocked: false,
        incomplete: type === "response.incomplete",
        webSearchCalls: tools.webSearchCalls,
        xSearchCalls: tools.xSearchCalls,
        images: tools.images,
      },
    };
  }
  return null;
}

export function responseFromBody(body: ResponsesBody, fallbackModel: string): XaiResponse {
  return {
    id: body.id || "resp_sin_id",
    model: body.model || fallbackModel,
    outputText: readOutputText(body),
    usage: body.usage ? readTokenUsage(body.usage) : EMPTY_USAGE,
    mocked: false,
  };
}

export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const rawEvent = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data) as unknown;
          } catch {
            // Un comentario o un ping no es un evento.
          }
        }
        split = buffer.indexOf("\n\n");
      }
    }
    const tail = buffer.trim();
    if (tail) {
      const data = tail
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") {
        try {
          yield JSON.parse(data) as unknown;
        } catch {
          // El cierre del stream puede dejar un fragmento incompleto.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
