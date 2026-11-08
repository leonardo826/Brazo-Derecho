import { EMPTY_USAGE, type TokenUsage } from "@/lib/pricing";
import type { XaiResponse, XaiStreamEvent } from "@/lib/xai/types";

export type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

export type ResponsesBody = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
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
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const chunks: string[] = [];
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text?.trim()) chunks.push(part.text.trim());
    }
  }
  return chunks.join("\n").trim();
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
    return { type: "delta", text: event.delta };
  }
  const itemType = event.item?.type ?? "";
  if (type.includes("web_search") || itemType === "web_search_call" || itemType.includes("web_search")) {
    return { type: "status", text: "Buscando la norma vigente…" };
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const body = event.response ?? (raw as ResponsesBody);
    return {
      type: "done",
      response: {
        id: body.id || "resp_sin_id",
        model: body.model || "",
        outputText: readOutputText(body),
        usage: readTokenUsage(body.usage),
        mocked: false,
        incomplete: type === "response.incomplete",
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
