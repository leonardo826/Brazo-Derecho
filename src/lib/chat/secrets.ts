import { wantsSecureCredentialForm } from "@/lib/chat/sensitive";

/**
 * Texto fijo cuando el mensaje pide un acceso o asigna una clave.
 * No incluye ningún carácter del texto original.
 *
 * Una asignación (`clave`/`contraseña`/`password`/`passwd` con `:`, `=`,
 * `es` o `is`) cierra el mensaje entero, aunque el valor sea corto, alfabético
 * o unicode. Pueden ir hasta cuatro palabras entre la etiqueta y esa
 * asignación (`del SII`, `de la empresa`, `aquí`). Sin asignación, un token
 * con aspecto de clave también cierra, con el mismo margen. No reconoce un
 * secreto suelto sin esa etiqueta, ni mira archivos adjuntos.
 * «La clave del F29 es el plazo» no es una asignación: el valor no parece secreto.
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

/**
 * Lo que el compositor puede enviar. Un secreto no sale del navegador.
 * La intención de formulario, sin valor, sí: el servidor sella, responde el
 * formulario y conserva el archivo.
 */
export function prepareComposerTurn<T>(raw: string, files: readonly T[]) {
  if (!carriesSuspectedSecret(raw)) return { text: raw, files, seal: shouldDropUserText(raw) };
  return { text: SAFE_CREDENTIAL_ENTRY, files: [] as readonly T[], seal: true };
}

const GAP_WORDS = 4;
const BRIDGE = /^(?:[:=]|\uFF1A|\uFF1D|(?:es|sea|is)\b)/iu;

/**
 * El texto trae un valor de clave. La intención de formulario, sin valor, no cuenta:
 * en ese caso el adjunto se conserva.
 */
export function carriesSuspectedSecret(text: string) {
  for (const match of text.matchAll(MARKER)) {
    const rest = text.slice((match.index ?? 0) + match[0].length);
    if (secretValueFollows(rest)) return true;
  }
  return false;
}

function assignedLine(rest: string) {
  const value = rest.replace(/^\s+/, "");
  if (!value) return "";
  const lines = value.split(/\r?\n/);
  let line = (lines[0] ?? "").trim();
  if (!line) line = (lines[1] ?? "").trim();
  return line;
}

function isAssignment(mark: string) {
  return mark === ":" || mark === "=" || mark === "\uFF1A" || mark === "\uFF1D";
}

function bareToken(token: string) {
  return token.replace(/^[¿¡"'(«»]+|[.,;:!?)"'»«]+$/gu, "");
}

function secretValueFollows(rest: string) {
  let pending = rest;
  let skipped = 0;
  while (skipped <= GAP_WORDS) {
    const head = pending.replace(/^\s+/, "");
    if (!head) return false;
    const bridge = head.match(BRIDGE);
    if (bridge) {
      const line = assignedLine(head.slice(bridge[0].length));
      if (!line) return false;
      // Pegada a la etiqueta, o con «:»/«=», cualquier valor cierra el mensaje.
      // Con palabras de por medio, «es»/«is» solo cierra si el valor parece secreto
      // («La clave del F29 es el plazo» sigue siendo una explicación).
      if (skipped === 0 || isAssignment(bridge[0])) return true;
      return tokenLooksSecret(line.split(/\s+/)[0] ?? "");
    }
    if (skipped === GAP_WORDS) return false;
    const word = head.match(/^(\S+)/u);
    const token = word?.[1];
    if (!token) return false;
    const inline = token.match(/^(.*?)([:=]|\uFF1A|\uFF1D)(.*)$/u);
    if (inline?.[2] && !token.includes("://")) {
      const line = assignedLine(`${inline[3] ?? ""}${head.slice(token.length)}`);
      if (line) return true;
    }
    if (tokenLooksSecret(token)) return true;
    if (bareToken(token)) skipped += 1;
    pending = head.slice(token.length);
  }
  return false;
}

function tokenLooksSecret(token: string) {
  const bare = token.replace(/^[¿¡"'(]+|[.,;:!?)"']+$/g, "");
  if (bare.length < 4) return false;
  if (FUNCTION_WORD.has(bare.toLowerCase())) return false;
  if (/[A-Za-z]/.test(bare) && /\d/.test(bare) && bare.length >= 6) return true;
  return /[.;,@#/+=!?*_\-]/.test(bare) && /[A-Za-z0-9]/.test(bare);
}
