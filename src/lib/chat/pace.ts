export type ReplyPace = {
  maxOutputTokens: number;
  webSearch: boolean;
  reasoningEffort: "low" | "medium";
};

const LONG =
  /\b(an[aá]lisis completo|revisi[oó]n completa|en detalle|detalla(?:r|me)?|expl[ií]ca(?:r|me)?|fundamento|paso a paso|desarrolla|documento|veinte casos|20 casos)\b/i;
const SEARCH = /\b(busca(?:r|me)?|norma vigente|con fuente|cita(?:r)? la|actualizaci[oó]n normativa)\b/i;

/** Tope de salida. No es un corte de una respuesta técnica que el pedido pide completa. */
export function replyPace(text: string): ReplyPace {
  const clean = text.replace(/\s+/g, " ").trim();
  const long = LONG.test(clean);
  const webSearch = SEARCH.test(clean);
  return {
    maxOutputTokens: long ? 1200 : 220,
    webSearch,
    reasoningEffort: long || webSearch ? "medium" : "low",
  };
}
