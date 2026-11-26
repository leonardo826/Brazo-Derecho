import { carriesSuspectedSecret } from "@/lib/chat/secrets";

const KEY =
  /\b(?:sk|rk|pk|xai|ghp|github_pat|AKIA)[-_][A-Za-z0-9_\-]{8,}\b|\b(?:api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token)\b\s*[:=]\s*\S+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi;
const PEM = /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g;
const CARD_CHUNK = /(?:\d[ -]?){13,19}/g;

function luhnOk(digits: string) {
  let sum = 0;
  let alt = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (alt) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Número de tarjeta (13 a 19 dígitos que pasan Luhn), aunque venga con espacios. */
export function containsPaymentCard(text: string) {
  CARD_CHUNK.lastIndex = 0;
  for (const match of text.matchAll(CARD_CHUNK)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhnOk(digits)) return true;
  }
  return false;
}

export function containsAccessKey(text: string) {
  KEY.lastIndex = 0;
  BEARER.lastIndex = 0;
  PEM.lastIndex = 0;
  return KEY.test(text) || BEARER.test(text) || PEM.test(text);
}

/**
 * Claves, contraseñas, tarjetas y llaves de acceso. Un RUT, un rubro o un tono no entran aquí.
 * «La clave del F29 es el plazo» tampoco: explica un concepto, no asigna una clave.
 */
export function containsBlockedSecret(text: string) {
  return carriesSuspectedSecret(text) || containsPaymentCard(text) || containsAccessKey(text);
}

const PHRASES = [
  /\bignor(?:a|ar|en|e)\b.{0,80}\binstrucciones?\b/i,
  /\bolvid(?:a|ar|en|e)\b.{0,80}\binstrucciones?\b/i,
  /\bactua como\b/i,
  /\ba partir de ahora\b/i,
  /\bsiempre responde\b/i,
  /\bprompt del? sistema\b/i,
  /\b(?:regala(?:r)?|da(?:r)?)\b.{0,50}\d+\s*%.{0,50}\ba todos\b/i,
  /\bignore\b.{0,60}\binstructions\b/i,
  /\bforget\b.{0,60}\binstructions\b/i,
  /\bact as\b/i,
  /\bfrom now on\b/i,
  /\bsystem prompt\b/i,
];

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function withoutAccent(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Un solo dominio, sin ruta ni consulta: el sitio de la empresa. Cualquier otra URL no. */
export function hasDisallowedUrl(text: string) {
  URL_IN_TEXT.lastIndex = 0;
  const urls = [...text.matchAll(URL_IN_TEXT)].map((match) => match[0].replace(/[),.;]+$/g, ""));
  if (urls.length === 0) return false;
  if (urls.length > 1) return true;
  const raw = urls[0] ?? "";
  const withScheme = raw.startsWith("www.") ? `https://${raw}` : raw;
  try {
    const parsed = new URL(withScheme);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return true;
    if (!parsed.hostname.includes(".")) return true;
    return parsed.pathname.replace(/\/+$/g, "") !== "";
  } catch {
    return true;
  }
}

/**
 * Orden dirigida al modelo, no una palabra suelta del negocio.
 * «Sistema Spa», un descuento a clientes frecuentes o las instrucciones de despacho siguen.
 */
export function looksLikeInstruction(text: string) {
  const plain = withoutAccent(text);
  if (hasDisallowedUrl(plain)) return true;
  return PHRASES.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(plain);
  });
}

export function rejectMemoryFact(text: string) {
  return containsBlockedSecret(text) || looksLikeInstruction(text);
}

/** El modelo de extracción no recibe el secreto. El filtro de salida es la segunda barrera. */
export function redactForExtraction(text: string) {
  if (carriesSuspectedSecret(text)) return "[omitido: el mensaje trae una clave]";
  KEY.lastIndex = 0;
  BEARER.lastIndex = 0;
  PEM.lastIndex = 0;
  CARD_CHUNK.lastIndex = 0;
  return text
    .replace(PEM, "[omitido]")
    .replace(KEY, "[omitido]")
    .replace(BEARER, "Bearer [omitido]")
    .replace(CARD_CHUNK, (chunk) => {
      const digits = chunk.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19 || !luhnOk(digits)) return chunk;
      return "[omitido]";
    });
}
