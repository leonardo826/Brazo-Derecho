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
  | { type: "marketing_image"; summary: string; channel: string };

export type XaiRequest = {
  model: string;
  instructions: string;
  task: XaiTask;
  usage: TokenUsage;
};

export type XaiResponse = {
  id: string;
  model: string;
  outputText: string;
  usage: TokenUsage;
  mocked: true;
};

export interface XaiClient {
  respond(request: XaiRequest): Promise<XaiResponse>;
}
