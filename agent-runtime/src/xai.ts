import { parseAction } from "./actions.ts";
import { credentialPrompt, type CredentialMeta } from "./credentials.ts";
import type { ComputerModel, ModelDecision } from "./desktop.ts";
import { isHighRiskGoal } from "./sensitive.ts";

export type ComputerModelName = "grok-4.3" | "grok-4.7";

const INSTRUCTIONS = [
  "Eres el agente de computador de IA Bot, para una pyme en Chile.",
  "Ves una captura del escritorio y eliges una sola acción con la herramienta computer.",
  "Puedes click, type, key, scroll, goto (solo http o https) o fill.",
  "WhatsApp Web puede estar abierto para que la persona escanee el QR. No escribas en ese chat, no envíes mensajes y no hagas envíos masivos.",
  "No pagues, no transfieras y no presentes declaraciones ni confirmes compras, salvo que el mensaje diga que el cliente ya confirmó.",
  "Si el objetivo es entrar a un portal (SII, ventas, F29) y hay credencial, usa fill con credentialId. Solo ves id, etiqueta, portal y pista de usuario.",
  "No escribas la clave en text ni en result, y no inventes claves. Si no hay credencial, el result indica abrir /panel/boveda.",
  "Cuando el objetivo esté cumplido, usa action done. El result va en una o dos frases, en español de Chile.",
].join(" ");

const COMPUTER_TOOL = {
  type: "function",
  name: "computer",
  description:
    "Una sola acción sobre el escritorio. Para entrar con la Bóveda usa fill y credentialId. Para terminar, action=done. El result va en una o dos frases.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["click", "type", "key", "scroll", "goto", "fill", "done"] },
      x: { type: "number" },
      y: { type: "number" },
      text: { type: "string" },
      key: { type: "string" },
      dy: { type: "number" },
      url: { type: "string" },
      credentialId: { type: "string" },
      result: { type: "string" },
    },
    required: ["action"],
  },
};

export function computerModelName(requested?: string): ComputerModelName {
  return requested?.trim() === "grok-4.7" ? "grok-4.7" : "grok-4.3";
}

export function resolveXaiMode(env: { XAI_MODE?: string; XAI_API_KEY?: string }) {
  if ((env.XAI_MODE ?? "").trim() === "mock") return "mock" as const;
  if (!(env.XAI_API_KEY ?? "").trim()) return "mock" as const;
  return "live" as const;
}

export function buildComputerRequest(input: {
  model: ComputerModelName;
  goal: string;
  screenshot: Buffer;
  history: string[];
  credentials?: CredentialMeta[];
  clientConfirmed?: boolean;
}) {
  const history = input.history.slice(-12).join("\n");
  const confirmation = !isHighRiskGoal(input.goal)
    ? "Esta tarea no es declarar ni pagar."
    : input.clientConfirmed
      ? "El cliente confirmó esta declaración o pago."
      : "El cliente no confirmó. No declares ni pagues.";
  return {
    model: input.model,
    store: false,
    instructions: INSTRUCTIONS,
    max_output_tokens: 400,
    reasoning: { effort: input.model === "grok-4.3" ? "low" : "medium" },
    tool_choice: "required",
    tools: [COMPUTER_TOOL],
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: `data:image/png;base64,${input.screenshot.toString("base64")}` },
          {
            type: "input_text",
            text: [
              `Objetivo: ${input.goal}`,
              credentialPrompt(input.credentials),
              confirmation,
              history ? `Pasos ya hechos:\n${history}` : "Todavía no hay pasos.",
              "Elige una sola acción. Si rellenas un acceso, usa fill con credentialId. No repitas claves. Si no hay credencial, indica /panel/boveda.",
            ].join("\n\n"),
          },
        ],
      },
    ],
  };
}

export function decisionFromXai(body: unknown): ModelDecision {
  if (!body || typeof body !== "object") throw new Error("xai_vacio");
  const output = (body as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const row = item as { type?: string; name?: string; arguments?: string };
      if (row.type !== "function_call" || row.name !== "computer" || typeof row.arguments !== "string") continue;
      let args: unknown;
      try {
        args = JSON.parse(row.arguments);
      } catch {
        throw new Error("xai_args");
      }
      return decisionFromArgs(args);
    }
  }
  const text = looseText(body);
  if (text) return { kind: "done", result: text.slice(0, 2000) };
  throw new Error("xai_sin_accion");
}

function decisionFromArgs(args: unknown): ModelDecision {
  if (!args || typeof args !== "object") throw new Error("xai_args");
  const record = args as Record<string, unknown>;
  if (record.action === "done") {
    const result = typeof record.result === "string" && record.result.trim() ? record.result.trim() : "Listo.";
    return { kind: "done", result: result.slice(0, 2000) };
  }
  const parsed = parseAction({ ...record, type: record.action });
  if (!parsed.ok) throw new Error("xai_args");
  return { kind: "act", action: parsed.action };
}

function looseText(body: object) {
  const record = body as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim();
  if (!Array.isArray(record.output)) return "";
  const chunks: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) chunks.push(text.trim());
    }
  }
  return chunks.join("\n").trim();
}

export function createLiveComputerModel(options: {
  apiKey: string;
  baseUrl: string;
  model: ComputerModelName;
  fetchImpl?: typeof fetch;
}): ComputerModel {
  return {
    async decide(ctx) {
      if (ctx.screenshot.length > 4_000_000) throw new Error("captura_grande");
      const response = await (options.fetchImpl ?? fetch)(`${options.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildComputerRequest({
            model: options.model,
            goal: ctx.goal,
            screenshot: ctx.screenshot,
            history: ctx.history,
            credentials: ctx.credentials,
            clientConfirmed: ctx.clientConfirmed,
          }),
        ),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error("xai_http");
      try {
        return decisionFromXai(text ? JSON.parse(text) : {});
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("xai_")) throw error;
        throw new Error("xai_json");
      }
    },
  };
}
