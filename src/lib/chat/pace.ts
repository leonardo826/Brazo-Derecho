export type ReplyPace = {
  /** Tope de cada tramo. Un entregable puede ocupar varios tramos. */
  maxOutputTokens: number;
  rounds: number;
  webSearch: boolean;
  reasoningEffort: "low" | "medium";
};

const DELIVERABLE =
  /\b(\d+\s+ejemplos|ejemplos completos|veinte casos|20 casos|fundamento|paso a paso|desarrolla|lista completa|an[aá]lisis completo|revisi[oó]n completa|f29 completo)\b/i;
const DEPTH =
  /\b(expl[ií]c\w*|detall\w*|c[aá]lculo|calcul\w*|lista|tabla|f29 completo|fundamento)\b|\bpor qu[eé](?=\s|$|[?.!,])/i;
const CALC = /\b(calcul\w*|c[aá]lculo|%\s+de|por ciento|advierte|advertencia)\b/i;
const CURRENT =
  /\b(este mes|esta semana|hoy|vence|vencimiento|utm|uf\b|ipc|d[oó]lar|tasa|plazo|vigente|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20[2-3]\d)\b/i;
const SEARCH = /\b(busca\w*|b[uú]squeda|informaci[oó]n sobre|con fuente|fuentes)\b/i;
const TRIVIAL = /^(hola|buenas|gracias|ok|listo|chao|adi[oó]s)[.!?\s]*$/i;

export const LIMIT_NOTE = "(Respuesta incompleta por el límite de salida.)";
export const FAILURE_NOTE = "(Respuesta incompleta por un fallo al continuar.)";
export const TRUNCATION_NOTE = LIMIT_NOTE;

/**
 * Une tramos. Sin texto no inventa un aviso.
 * Un corte del proveedor o un fallo al seguir no se presentan como respuesta terminada.
 */
export function finishReply(
  parts: { text: string; incomplete: boolean }[],
  reason: "limit" | "failure" = "limit",
) {
  const body = parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!body) return { text: "", truncated: false, note: "" };
  const providerCut = parts[parts.length - 1]?.incomplete === true;
  const truncated = providerCut || reason === "failure";
  const note = !truncated ? "" : reason === "failure" ? FAILURE_NOTE : LIMIT_NOTE;
  return {
    text: note ? `${body}\n\n${note}` : body,
    truncated,
    note,
  };
}

/**
 * Brevedad por defecto. Un entregable pedido no se da por cerrado con un solo tope.
 * Un dato de este mes, un año, o un pedido explícito de buscar o de fuente, se verifica.
 * Una charla trivial no busca. Pedir explicación o detalle alarga, aunque no sea un dato vigente.
 */
export function replyPace(text: string): ReplyPace {
  const clean = text.replace(/\s+/g, " ").trim();
  const deliverable = DELIVERABLE.test(clean);
  const calc = CALC.test(clean);
  const webSearch = !TRIVIAL.test(clean) && (CURRENT.test(clean) || SEARCH.test(clean));
  if (deliverable) {
    return { maxOutputTokens: 2000, rounds: 4, webSearch, reasoningEffort: "medium" };
  }
  if (calc || DEPTH.test(clean)) {
    return { maxOutputTokens: 800, rounds: 1, webSearch, reasoningEffort: "low" };
  }
  return {
    maxOutputTokens: 220,
    rounds: 1,
    webSearch,
    reasoningEffort: webSearch ? "medium" : "low",
  };
}
