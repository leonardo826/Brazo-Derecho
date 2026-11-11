import type { TokenUsage } from "@/lib/pricing";

export type XaiTask =
  | { type: "whatsapp_answer"; title: string; body: string }
  | { type: "whatsapp_escalate" }
  | { type: "whatsapp_refuse"; reply: string }
  | {
      type: "quote_note";
      customerName: string;
      lineCount: number;
      totalClp: number;
      unmatched: string;
    }
  | {
      type: "marketing_post";
      channel: string;
      voice: string;
      audience: string;
      summary: string;
      index: number;
    }
  | { type: "marketing_image"; summary: string; channel: string }
  | { type: "accounting_question"; question: string; today: string }
  | { type: "agent_chat"; today: string; messages: ChatMessageInput[] };

export type ChatFileInput = {
  name: string;
  mime: string;
  note?: string;
  imageDataUrl?: string;
};

export type ChatMessageInput = {
  role: "user" | "assistant";
  text: string;
  files?: ChatFileInput[];
};

export type XaiRequest = {
  model: string;
  instructions: string;
  task: XaiTask;
  usage: TokenUsage;
  businessName?: string;
  maxOutputTokens?: number;
  /** Búsqueda web pública. false la apaga. En una consulta contable suelta, queda encendida. */
  webSearch?: boolean;
  /** Apagado: x_search se cobra por post y por perfil. */
  xSearch?: boolean;
  /** Solo Marketing, y solo si pidieron una imagen y queda cupo. */
  imageGeneration?: boolean;
  reasoningEffort?: "low" | "medium";
  signal?: AbortSignal;
};

export type XaiResponse = {
  id: string;
  model: string;
  outputText: string;
  usage: TokenUsage;
  mocked: boolean;
  /** El proveedor cortó por el tope. No es un final natural. */
  incomplete?: boolean;
  webSearchCalls?: number;
  xSearchCalls?: number;
  images?: { fileName: string; mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array }[];
};

export type XaiStreamEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; response: XaiResponse };

export interface XaiClient {
  respond(request: XaiRequest): Promise<XaiResponse>;
  streamRespond(request: XaiRequest): AsyncIterable<XaiStreamEvent>;
}
