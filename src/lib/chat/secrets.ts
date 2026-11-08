import { wantsSecureCredentialForm } from "@/lib/chat/sensitive";

/**
 * Texto fijo cuando el mensaje pide un acceso o asigna una clave.
 * No incluye ningún carácter del texto original.
 *
 * Una asignación pegada a la etiqueta, o con «:» o «=», cierra el mensaje
 * entero. Con hasta cuatro palabras entre la etiqueta y «es», «sea» o «is»,
 * también lo cierra si el contexto es de credencial (contraseña, «mi clave»,
 * SII, empresa u otro acceso) y lo que sigue no es una frase explicativa.
 * Ese valor puede ser corto, alfabético o unicode, y puede ir en la línea
 * siguiente: no se descarta por entropía ni por apariencia.
 * «La clave del F29 es el plazo» sigue siendo una explicación.
 * Sin asignación, un token con aspecto de clave también cierra, con el mismo
 * margen. No reconoce un secreto suelto sin esa etiqueta, ni mira archivos.
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
    const index = match.index ?? 0;
    const rest = text.slice(index + match[0].length);
    if (secretValueFollows(rest, match[0], text.slice(0, index))) return true;
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

const CREDENTIAL_ANCHOR = new Set([
  "sii",
  "previred",
  "tesoreria",
  "tesorería",
  "empresa",
  "banco",
  "portal",
  "boveda",
  "bóveda",
  "acceso",
  "usuario",
  "rut",
]);

function labelIsPassword(label: string) {
  return /^(?:contrase(?:ñ|n)as?|passwords?|passwds?|passcodes?)$/i.test(label);
}

function hasPossessive(before: string) {
  return /(?:^|\s)(?:mi|mis|tu|tus|su|sus|my|your)\s+$/iu.test(before);
}

function valueTokens(line: string) {
  return line
    .split(/\s+/)
    .map((token) => bareToken(token))
    .filter(Boolean);
}

/** «es el plazo» explica un concepto. «es hola» asigna un valor, aunque sea corto. */
function isExplanatoryPhrase(line: string) {
  const word = valueTokens(line)[0]?.toLowerCase() ?? "";
  if (!word) return true;
  if (FUNCTION_WORD.has(word)) return true;
  return (
    word === "unos" ||
    word === "unas" ||
    word === "esto" ||
    word === "eso" ||
    word === "este" ||
    word === "lo" ||
    word === "a" ||
    word === "an" ||
    word === "that" ||
    word === "this" ||
    word === "cuando" ||
    word === "como" ||
    word === "cómo" ||
    word === "cual" ||
    word === "cuál"
  );
}

function copulaAssignsCredential(label: string, before: string, gap: readonly string[], line: string) {
  if (isExplanatoryPhrase(line)) return false;
  if (labelIsPassword(label)) return true;
  if (hasPossessive(before)) return true;
  return gap.some((token) => CREDENTIAL_ANCHOR.has(token.toLowerCase()));
}

function secretValueFollows(rest: string, label: string, before: string) {
  let pending = rest;
  let skipped = 0;
  const gap: string[] = [];
  while (skipped <= GAP_WORDS) {
    const head = pending.replace(/^\s+/, "");
    if (!head) return false;
    const bridge = head.match(BRIDGE);
    if (bridge) {
      const line = assignedLine(head.slice(bridge[0].length));
      if (!line) return false;
      // Pegada a la etiqueta, o con «:»/«=», cualquier valor cierra el mensaje.
      // Con palabras de por medio, «es»/«is» cierra la credencial entera sin
      // mirar si el valor parece una clave. Una frase («el plazo») no lo es.
      if (skipped === 0 || isAssignment(bridge[0])) return true;
      return copulaAssignsCredential(label, before, gap, line);
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
    const bare = bareToken(token);
    if (bare) {
      skipped += 1;
      gap.push(bare);
    }
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
