import { safeHref, softenCitationLinks } from "@/lib/chat/markdown";

const TOOL_ITEM = new Set([
  "web_search_call",
  "x_search_call",
  "image_generation_call",
  "function_call",
  "tool_call",
]);

type Citation = { type?: string; url?: string };
type OutputPart = { type?: string; text?: string; annotations?: Citation[] };
type OutputItem = { type?: string; content?: OutputPart[] };

export type AnswerBody = {
  output_text?: string;
  citations?: string[];
  output?: OutputItem[];
};

const PROGRESS =
  /^(?:necesito|reviso|busco|estoy buscando|voy a (?:buscar|revisar|mirar)|d[eé]jame|consulto|miro|abro|preparando la imagen|buscando en la web)\b/i;

export function isImagePayload(text: string) {
  if (/data:image\//i.test(text)) return true;
  const compact = text.replace(/\s/g, "");
  return compact.length > 2_000 && /^[A-Za-z0-9+/=]+$/.test(compact);
}

export function stripEmbeddedImages(text: string) {
  return text
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]{40,}/gi, "")
    .replace(/[A-Za-z0-9+/]{500,}={0,2}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isProgress(sentence: string) {
  const clean = sentence.trim();
  if (!clean || clean.length > 140) return false;
  if (/\d{1,2}:\d{2}/.test(clean) || /https?:\/\//i.test(clean)) return false;
  if (/^confirmo[.…]?$/i.test(clean)) return true;
  if (/^(?:faltan?|a[uú]n no|todav[ií]a no)\b/i.test(clean) && !/\d/.test(clean)) return true;
  return PROGRESS.test(clean);
}

/** Saca frases de avance que el modelo pega al texto, incluso sin espacio tras el punto. */
export function dropProgressNarration(text: string) {
  const spaced = text.replace(/([.!?])(?=[A-ZÁÉÍÓÚÑ¿])/g, "$1 ");
  const sentences = spaced.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  if (sentences.length < 2) return text.trim();
  const kept = sentences.filter((sentence) => !isProgress(sentence));
  if (kept.length === 0 || kept.length === sentences.length) return text.trim();
  return kept.join(" ").replace(/[ \t]{2,}/g, " ").trim();
}

function hostnameLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function domainKey(url: string) {
  return hostnameLabel(url).toLowerCase();
}

function addSource(urls: string[], seen: Set<string>, raw: string) {
  const href = safeHref(raw.trim());
  if (!href) return;
  const domain = domainKey(href);
  if (!domain || seen.has(domain)) return;
  seen.add(domain);
  urls.push(href);
}

function collectUrls(body: AnswerBody) {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const url of body.citations ?? []) addSource(urls, seen, url);
  for (const item of body.output ?? []) {
    for (const part of item.content ?? []) {
      for (const note of part.annotations ?? []) {
        if (note.url) addSource(urls, seen, note.url);
      }
    }
  }
  return { urls, seen };
}

function isToolItem(item: OutputItem) {
  return Boolean(item.type && (TOOL_ITEM.has(item.type) || item.type === "reasoning"));
}

function itemText(item: OutputItem) {
  const chunks: string[] = [];
  for (const part of item.content ?? []) {
    if ((part.type === "output_text" || part.type === "text" || !part.type) && part.text?.trim()) chunks.push(part.text.trim());
  }
  return chunks.join("\n").trim();
}

function messageText(items: OutputItem[]) {
  return items
    .filter((item) => !isToolItem(item))
    .map(itemText)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function finalSegment(items: OutputItem[]) {
  let lastTool = -1;
  items.forEach((item, index) => {
    if (item.type && TOOL_ITEM.has(item.type)) lastTool = index;
  });
  if (lastTool < 0) return "";
  const answers = items.slice(lastTool + 1).filter((item) => !isToolItem(item) && itemText(item));
  return answers.length > 0 ? itemText(answers[answers.length - 1] ?? { content: [] }) : "";
}

export function withSources(text: string, urls: string[]) {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const url of urls) addSource(sources, seen, url);
  let body = text.replace(/\[\[(\d+)\]\]\((https?:\/\/[^)\s]+)\)/g, (_match, _n, url: string) => {
    addSource(sources, seen, url);
    return "";
  });
  body = softenCitationLinks(body);
  body = body.replace(/\[(\d+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, _n, url: string) => {
    addSource(sources, seen, url);
    return "";
  });
  body = body.replace(/\[\(fuente\)\]\((https?:\/\/[^)\s]+)\)/g, (full, url: string) => {
    addSource(sources, seen, url);
    return full;
  });
  body = body
    .replace(/\n+Fuentes:\n[\s\S]*$/i, "")
    .replace(/(?:^|\n)[ \t]*Fuentes?:\s*(?:https?:\/\/\S+|\[[^\]]+\]\([^)]+\))[ \t]*/gi, "\n")
    .replace(/[ \t]+Fuentes?:\s*https?:\/\/\S+/gi, "")
    .replace(/\n+[ \t]*(?:(?:\[\[)?\d{1,2}(?:\]\])?[ \t]*)+$/g, (line) => {
      const numbers = line.match(/\d{1,2}/g) ?? [];
      return numbers.length >= 2 && numbers.every((value) => Number(value) <= 30) ? "" : line;
    })
    .replace(/(?<=[.!?])[ \t]+(?:\d{1,2}[ \t]*){2,8}$/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (sources.length === 0) return body;
  const list = sources.map((url) => `- [${hostnameLabel(url)}](${url})`).join("\n");
  return `${body}\n\nFuentes:\n${list}`;
}

/**
 * La respuesta guardada es el texto posterior a la última herramienta.
 * El avance («Reviso…», «Confirmo.») no se conserva. Las citas quedan como Fuentes.
 */
export function composeAnswer(body: AnswerBody) {
  const items = body.output ?? [];
  const { urls } = collectUrls(body);
  const segment = finalSegment(items);
  const fallback = (body.output_text ?? "").trim() || messageText(items);
  const text = stripEmbeddedImages(dropProgressNarration(segment || fallback));
  return withSources(text, urls);
}
