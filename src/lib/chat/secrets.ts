import { wantsSecureCredentialForm } from "@/lib/chat/sensitive";

/**
 * Texto fijo cuando el mensaje pide un acceso o parece traer una clave.
 * No incluye ningún carácter del texto original: un recorte parcial deja
 * fragmentos (Demo.1234 → [redactado].1234). No promete reconocer toda clave.
 */
export const SAFE_CREDENTIAL_ENTRY =
  "Quiero usar el formulario seguro de la Bóveda. No dejo la clave en el chat.";

const MARKER = /\b(claves?|contrase(?:ñ|n)as?|passwords?|passwds?|passcodes?)\b/gi;

const FUNCTION_WORD = new Set([
  "del",
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "en",
  "al",
  "para",
  "por",
  "con",
  "que",
  "está",
  "esta",
  "son",
  "mi",
  "su",
  "tu",
  "the",
  "of",
  "for",
  "to",
  "my",
  "your",
  "and",
  "or",
  "y",
  "o",
]);

/** Hay una clave pegada, o el pedido es guardar/entrar. El texto original no se conserva. */
export function shouldDropUserText(text: string) {
  return wantsSecureCredentialForm(text) || carriesSuspectedSecret(text);
}

export function sealChatText(text: string) {
  return shouldDropUserText(text) ? SAFE_CREDENTIAL_ENTRY : text;
}

function carriesSuspectedSecret(text: string) {
  for (const match of text.matchAll(MARKER)) {
    const rest = text.slice((match.index ?? 0) + match[0].length);
    if (secretValueFollows(rest)) return true;
  }
  return false;
}

function secretValueFollows(rest: string) {
  const bridge = rest.match(/^\s*(?::|=|(?:es|sea|is)\b)/i);
  let value = bridge ? rest.slice(bridge[0].length) : rest;
  value = value.replace(/^\s+/, "");
  if (!value) return false;
  const lines = value.split(/\r?\n/);
  let line = (lines[0] ?? "").trim();
  if (!line && bridge) line = (lines[1] ?? "").trim();
  if (!line) return false;
  if (!bridge) {
    const token = line.split(/\s+/)[0] ?? "";
    if (FUNCTION_WORD.has(token.toLowerCase().replace(/^[¿¡]+|[.,;:!?]+$/g, ""))) return false;
    return tokenLooksSecret(token);
  }
  return line.split(/\s+/).some((token) => tokenLooksSecret(token));
}

function tokenLooksSecret(token: string) {
  const bare = token.replace(/^[¿¡"'(]+|[.,;:!?)"']+$/g, "");
  if (bare.length < 4) return false;
  if (FUNCTION_WORD.has(bare.toLowerCase())) return false;
  if (/[A-Za-z]/.test(bare) && /\d/.test(bare) && bare.length >= 6) return true;
  return /[.;,@#/+=!?*_\-]/.test(bare) && /[A-Za-z0-9]/.test(bare);
}
