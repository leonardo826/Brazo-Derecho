import { EMPTY_USAGE, type TokenUsage } from "@/lib/pricing";
import { taskInput } from "@/lib/xai/prompt";
import type { XaiClient, XaiRequest, XaiResponse } from "@/lib/xai/types";

type ResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

type ResponsesBody = {
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

export class LiveXaiClient implements XaiClient {
  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async respond(request: XaiRequest): Promise<XaiResponse> {
    if (!request.instructions.trim()) {
      throw new Error("El agente necesita instrucciones");
    }
    if (request.task.type === "whatsapp_refuse") {
      return {
        id: "canned_refusal",
        model: request.model,
        outputText: request.task.reply,
        usage: EMPTY_USAGE,
        mocked: false,
      };
    }

    const effort = request.model === "grok-4.3" ? "low" : "medium";
    const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        instructions: request.instructions,
        input: taskInput(request.task, request.businessName),
        max_output_tokens: request.maxOutputTokens ?? 800,
        reasoning: { effort },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const text = await response.text();
    let body: ResponsesBody = {};
    if (text) {
      try {
        body = JSON.parse(text) as ResponsesBody;
      } catch {
        throw new Error("La API de xAI respondió en un formato que no pudimos leer");
      }
    }
    if (!response.ok) {
      throw new Error("La API de xAI no respondió");
    }
    const outputText = readOutputText(body);
    if (!outputText) {
      throw new Error("La API de xAI no entregó texto");
    }
    return {
      id: body.id || "resp_sin_id",
      model: body.model || request.model,
      outputText,
      usage: readTokenUsage(body.usage),
      mocked: false,
    };
  }
}
