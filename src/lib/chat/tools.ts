import type { ChatAgentId } from "@/lib/chat/agents";
import { chatSurface } from "@/lib/chat/agents";
import { recordsBillingUsage } from "@/lib/qa-account";

export type ServerTool = { type: "web_search" | "x_search" | "image_generation" };

const TRIVIAL = /^(hola|buenas|gracias|ok|listo|chao|adi[oó]s)[.!?\s]*$/i;
const SITE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:cl|com|org|net|io)\b/i;
const IMAGE_ASK = /\b(imagen|im[aá]genes|publicitaria|afiche|banner|foto para)\b/i;

export function messageNeedsWeb(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || TRIVIAL.test(clean)) return false;
  return true;
}

export function messageNamesSite(text: string) {
  return SITE.test(text);
}

export function messageAsksImage(text: string) {
  return IMAGE_ASK.test(text);
}

/**
 * El agente decide cuándo llamar. El interruptor del agente las deja disponibles.
 * x_search sigue apagado: se cobra por post y por perfil.
 */
export function toolsForAgent(agent: ChatAgentId, imageRoom: number): ServerTool[] {
  const surface = chatSurface(agent);
  const tools: ServerTool[] = [];
  if (surface.webSearch) tools.push({ type: "web_search" });
  if (surface.xSearch) tools.push({ type: "x_search" });
  if (surface.images && imageRoom > 0) tools.push({ type: "image_generation" });
  return tools;
}

export type StoredImage = { fileName: string; mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array };

export type ToolReport = {
  webSearchCalls: number;
  xSearchCalls: number;
  images: StoredImage[];
};

type UsageShape = {
  server_side_tool_usage?: { web_search_calls?: number; x_search_calls?: number };
};

type OutputItem = {
  type?: string;
  result?: string;
};

export function readToolReport(body: { usage?: UsageShape; output?: OutputItem[] }): ToolReport {
  const usage = body.usage?.server_side_tool_usage;
  let webSearchCalls = Math.max(0, Math.round(usage?.web_search_calls ?? 0));
  let xSearchCalls = Math.max(0, Math.round(usage?.x_search_calls ?? 0));
  let seenWeb = 0;
  let seenX = 0;
  const images: StoredImage[] = [];
  for (const item of body.output ?? []) {
    if (item.type === "web_search_call") seenWeb += 1;
    if (item.type === "x_search_call") seenX += 1;
    if (item.type !== "image_generation_call" || !item.result) continue;
    const image = decodeGeneratedImage(item.result, images.length + 1);
    if (image) images.push(image);
  }
  if (webSearchCalls === 0) webSearchCalls = seenWeb;
  if (xSearchCalls === 0) xSearchCalls = seenX;
  return { webSearchCalls, xSearchCalls, images };
}

export function billedToolUse(isQa: boolean, searches: number, images: number) {
  if (!recordsBillingUsage(isQa)) return { reply: 0, searches: 0, images: 0 };
  return {
    reply: 1,
    searches: Math.max(0, Math.round(searches)),
    images: Math.max(0, Math.round(images)),
  };
}

function decodeGeneratedImage(result: string, index: number): StoredImage | null {
  const cleaned = result.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "").replace(/\s/g, "");
  if (!cleaned || cleaned.length > 8_000_000) return null;
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(cleaned, "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength < 8 || bytes.byteLength > 5_000_000) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { fileName: `publicidad-${index}.png`, mimeType: "image/png", bytes };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { fileName: `publicidad-${index}.jpg`, mimeType: "image/jpeg", bytes };
  }
  return null;
}
