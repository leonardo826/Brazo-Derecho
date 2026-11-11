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

const SOCIAL = /^(?:x\.com|twitter\.com|mobile\.twitter\.com|t\.co|facebook\.com|instagram\.com|tiktok\.com|linkedin\.com)$/;
const AIRLINE = /(?:^|\.)(?:latamairlines|latam|skyairline|jetsmart|avianca|copaair|voegol|aerolineas)\./;
const AIRPORT = /aeropuerto|dgac|nuevopudahuel/;

function isGovernment(host: string) {
  return host.endsWith(".gob.cl") || host.includes(".gob.") || host.endsWith(".gov.uk") || host.endsWith(".gov") || host.includes(".gov.");
}

function isAggregator(host: string) {
  return host === "google.com" || host === "kiwi.com" || /(?:^|\.)(?:kayak|skyscanner|momondo|expedia|despegar|edreams|cheapflights|tripadvisor|wikipedia|reddit|google)\./.test(`${host}.`);
}

function sourceRank(url: string, text: string) {
  const host = domainKey(url);
  if (!host) return -1;
  if (SOCIAL.test(host) || isAggregator(host)) return 0;
  if (isGovernment(host)) return 3;
  if (AIRLINE.test(`${host}.`) || AIRPORT.test(host)) return 2;
  if (text.toLowerCase().includes(host)) return 2;
  return 1;
}

function extractUrls(text: string) {
  const found: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s)>\]]+/gi)) found.push(match[0].replace(/[.,;:]+$/, ""));
  return found;
}

/** Solo lo citado en el texto. Oficial primero. Sin redes ni agregadores si hay una fuente oficial. */
export function citedSources(text: string, candidates: string[], limit: number, forced: string[] = []) {
  const pool: string[] = [];
  const seen = new Set<string>();
  const lower = text.toLowerCase();
  function consider(raw: string, force: boolean) {
    const href = safeHref(raw.trim());
    if (!href) return;
    const domain = domainKey(href);
    if (!domain || seen.has(domain)) return;
    const named = lower.includes(domain) || extractUrls(text).some((url) => domainKey(url) === domain);
    if (!force && !named) return;
    seen.add(domain);
    pool.push(href);
  }
  for (const url of forced) consider(url, true);
  for (const url of extractUrls(text)) consider(url, true);
  for (const url of candidates) consider(url, false);
  const ranked = pool.map((url) => ({ url, rank: sourceRank(url, text) })).filter((item) => item.rank >= 0);
  const official = ranked.some((item) => item.rank >= 2);
  const kept = (official ? ranked.filter((item) => item.rank >= 1) : ranked).sort((a, b) => b.rank - a.rank);
  return kept.slice(0, Math.max(0, limit)).map((item) => item.url);
}

export function capFuentes(text: string, limit: number) {
  const match = text.match(/\n+Fuentes:\n([\s\S]*)$/);
  if (!match || match.index === undefined) return text;
  const lines = match[1].split("\n").map((line) => line.trim()).filter((line) => line.startsWith("- "));
  if (lines.length <= limit) return text;
  return `${text.slice(0, match.index).trim()}\n\nFuentes:\n${lines.slice(0, limit).join("\n")}`;
}

export function sourceLimitFor(agent: string) {
  return agent === "WHATSAPP" ? 2 : 3;
}

function annotationUrls(items: OutputItem[]) {
  const urls: string[] = [];
  let lastTool = -1;
  items.forEach((item, index) => {
    if (item.type && TOOL_ITEM.has(item.type)) lastTool = index;
  });
  const segment = lastTool >= 0 ? items.slice(lastTool + 1) : items;
  for (const item of segment) {
    if (isToolItem(item)) continue;
    for (const part of item.content ?? []) {
      for (const note of part.annotations ?? []) {
        if (note.url) urls.push(note.url);
      }
    }
  }
  return urls;
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

export function withSources(text: string, urls: string[] = [], limit = 3, forced: string[] = []) {
  const sources = citedSources(text, urls, limit, forced);
  let body = text.replace(/\[\[(\d+)\]\]\((https?:\/\/[^)\s]+)\)/g, "");
  body = softenCitationLinks(body);
  body = body.replace(/\[(\d+)\]\((https?:\/\/[^)\s]+)\)/g, "");
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
  const segment = finalSegment(items);
  const fallback = (body.output_text ?? "").trim() || messageText(items);
  const text = stripEmbeddedImages(dropProgressNarration(segment || fallback));
  return withSources(text, body.citations ?? [], 3, annotationUrls(items));
}
