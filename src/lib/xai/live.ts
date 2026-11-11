import { linkAbortSignal } from "@/lib/chat/abort";
import { EMPTY_USAGE } from "@/lib/pricing";
import { modelInput } from "@/lib/xai/chat-input";
import { mapXaiStreamEvent, readOutputText, readSseData, readTokenUsage, type ResponsesBody } from "@/lib/xai/parse";
import { taskInput } from "@/lib/xai/prompt";
import type { XaiClient, XaiRequest, XaiResponse, XaiStreamEvent } from "@/lib/xai/types";

export { readOutputText, readTokenUsage } from "@/lib/xai/parse";

export class XaiApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "XaiApiError";
    this.status = status;
  }
}

export function xaiFailure(status: number, body: string) {
  return new XaiApiError(status, xaiErrorDetail(status, body));
}

export function xaiErrorDetail(status: number, body: string) {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "string") message = parsed.error;
    else if (parsed.error && typeof parsed.error.message === "string") message = parsed.error.message;
    else if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    message = body;
  }
  const clean = message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[clave]")
    .replace(/Bearer\s+\S+/gi, "Bearer [clave]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return `xAI ${status}: ${clean || "sin detalle"}`;
}

function inputFor(request: XaiRequest) {
  if (request.task.type === "agent_chat") return modelInput(request.task, request.businessName);
  if (request.task.type === "accounting_question") {
    return [
      request.businessName?.trim() ? `Cliente: ${request.businessName.trim()}.` : "",
      `Fecha de hoy: ${request.task.today}.`,
      "Consulta:",
      request.task.question,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return taskInput(request.task, request.businessName);
}

export function requestTools(request: XaiRequest) {
  const chat = request.task.type === "accounting_question" || request.task.type === "agent_chat";
  const web = request.webSearch === true || (request.task.type === "accounting_question" && request.webSearch !== false);
  const tools: { type: string }[] = [];
  if (chat && web) tools.push({ type: "web_search" });
  if (request.xSearch === true) tools.push({ type: "x_search" });
  if (request.imageGeneration === true) tools.push({ type: "image_generation" });
  return tools.length > 0 ? tools : undefined;
}

function requestBody(request: XaiRequest, stream: boolean) {
  const effort = request.reasoningEffort ?? (request.model === "grok-4.3" ? "low" : "medium");
  const tools = requestTools(request);
  return {
    model: request.model,
    instructions: request.instructions,
    input: inputFor(request),
    max_output_tokens: request.maxOutputTokens ?? 800,
    reasoning: { effort },
    ...(tools ? { tools } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

function slowTask(request: XaiRequest) {
  return request.task.type === "accounting_question" || request.task.type === "agent_chat";
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

    const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(request, false)),
      signal: linkAbortSignal(slowTask(request) ? 240_000 : 45_000, request.signal),
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
    if (!response.ok) throw xaiFailure(response.status, text);
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

  async *streamRespond(request: XaiRequest): AsyncGenerator<XaiStreamEvent> {
    if (!request.instructions.trim()) {
      throw new Error("El agente necesita instrucciones");
    }
    if (request.task.type === "whatsapp_refuse") {
      const canned: XaiResponse = {
        id: "canned_refusal",
        model: request.model,
        outputText: request.task.reply,
        usage: EMPTY_USAGE,
        mocked: false,
      };
      yield { type: "delta", text: canned.outputText };
      yield { type: "done", response: canned };
      return;
    }

    const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(request, true)),
      signal: linkAbortSignal(slowTask(request) ? 240_000 : 45_000, request.signal),
    });
    if (!response.ok) throw xaiFailure(response.status, await response.text());

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || contentType.includes("application/json")) {
      const text = await response.text();
      let body: ResponsesBody = {};
      try {
        body = text ? (JSON.parse(text) as ResponsesBody) : {};
      } catch {
        throw new Error("La API de xAI respondió en un formato que no pudimos leer");
      }
      const outputText = readOutputText(body);
      if (!outputText) throw new Error("La API de xAI no entregó texto");
      const done: XaiResponse = {
        id: body.id || "resp_sin_id",
        model: body.model || request.model,
        outputText,
        usage: readTokenUsage(body.usage),
        mocked: false,
      };
      yield { type: "delta", text: outputText };
      yield { type: "done", response: done };
      return;
    }

    let accumulated = "";
    let finished: XaiResponse | null = null;
    for await (const raw of readSseData(response.body)) {
      const mapped = mapXaiStreamEvent(raw);
      if (!mapped) continue;
      if (mapped.type === "delta") accumulated += mapped.text;
      if (mapped.type === "done") {
        finished = mapped.response.outputText
          ? { ...mapped.response, model: mapped.response.model || request.model }
          : { ...mapped.response, model: mapped.response.model || request.model, outputText: accumulated.trim() };
        yield { type: "done", response: finished };
        continue;
      }
      yield mapped;
    }
    if (!finished) {
      const outputText = accumulated.trim();
      if (!outputText) throw new Error("La API de xAI no entregó texto");
      yield {
        type: "done",
        response: {
          id: "resp_stream",
          model: request.model,
          outputText,
          usage: EMPTY_USAGE,
          mocked: false,
        },
      };
    }
  }
}
