export type ReplyPace = {
  /** Tope de cada tramo. Un entregable puede ocupar varios tramos. */
  maxOutputTokens: number;
  rounds: number;
  webSearch: boolean;
  reasoningEffort: "low" | "medium";
};

const DELIVERABLE =
  /\b(\d+\s+ejemplos|ejemplos completos|veinte casos|20 casos|fundamento|paso a paso|desarrolla|lista completa|an[aá]lisis completo|revisi[oó]n completa|f29 completo)\b/i;
const EXTENDED =
  /\b(c[aá]lculo|calcul\w*|explicaci[oó]n|lista|tabla|f29 completo|fundamento)\b|\bpor qu[eé](?=\s|$|[?.!,])/i;
const CALC = /\b(calcul\w*|c[aá]lculo|%\s+de|por ciento|advierte|advertencia)\b/i;
const CURRENT =
  /\b(este mes|esta semana|hoy|vence|vencimiento|utm|uf\b|ipc|d[oó]lar|tasa|plazo|vigente|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20[2-3]\d)\b/i;
const TRIVIAL = /^(hola|buenas|gracias|ok|listo|chao|adi[oó]s)[.!?\s]*$/i;

export const TRUNCATION_NOTE = "(Respuesta resumida; pide detalle si lo necesitas)";

/** Une tramos. Si el último sigue cortado, lo dice en vez de parecer completo. */
export function finishReply(parts: { text: string; incomplete: boolean }[]) {
  const body = parts
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const truncated = parts.length > 0 && parts[parts.length - 1]?.incomplete === true;
  return {
    text: truncated ? `${body}\n\n${TRUNCATION_NOTE}` : body,
    truncated,
  };
}

/**
 * Brevedad por defecto. Un entregable pedido no se da por cerrado con un solo tope.
 * Un dato de este mes o de un año se verifica; una charla trivial no busca.
 */
export function replyPace(text: string): ReplyPace {
  const clean = text.replace(/\s+/g, " ").trim();
  const deliverable = DELIVERABLE.test(clean);
  const calc = CALC.test(clean);
  const webSearch = !TRIVIAL.test(clean) && CURRENT.test(clean);
  if (deliverable) {
    return { maxOutputTokens: 2000, rounds: 4, webSearch, reasoningEffort: "medium" };
  }
  if (calc || EXTENDED.test(clean)) {
    return { maxOutputTokens: 800, rounds: 1, webSearch, reasoningEffort: "low" };
  }
  return {
    maxOutputTokens: 220,
    rounds: 1,
    webSearch,
    reasoningEffort: webSearch ? "medium" : "low",
  };
}
