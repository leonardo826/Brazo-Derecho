import type { ModelId } from "@/lib/catalog";

/**
 * Supuestos del plan al 29 de octubre de 2026.
 * No es una tarifa en vivo: la beta no consulta la API de xAI.
 * Dólar de trabajo: $900. Precios por millón de tokens.
 */
export const FX_CLP_PER_USD = 900;

export const MODEL_RATES: Record<ModelId, { input: number; cached: number; output: number }> = {
  "grok-4.3": { input: 1.25, cached: 0.2, output: 2.5 },
  "grok-4.7": { input: 2, cached: 0.5, output: 6 },
};

export const IMAGE_USD = 0.04;

export type TokenUsage = {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

export const USAGE_PRESETS: Record<"whatsapp" | "quote" | "text", TokenUsage> = {
  whatsapp: { inputTokens: 6000, cachedTokens: 4200, outputTokens: 400 },
  quote: { inputTokens: 15000, cachedTokens: 9000, outputTokens: 1500 },
  text: { inputTokens: 10000, cachedTokens: 5000, outputTokens: 2000 },
};

export const EMPTY_USAGE: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export function scaleUsage(usage: TokenUsage, quantity: number): TokenUsage {
  return {
    inputTokens: usage.inputTokens * quantity,
    cachedTokens: usage.cachedTokens * quantity,
    outputTokens: usage.outputTokens * quantity,
  };
}

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

export function estimateCostClp(
  byModel: Record<ModelId, TokenUsage>,
  imageCount: number,
): number {
  let usd = imageCount * IMAGE_USD;
  for (const model of Object.keys(byModel) as ModelId[]) {
    const rate = MODEL_RATES[model];
    const tokens = byModel[model];
    const uncached = Math.max(0, tokens.inputTokens - tokens.cachedTokens);
    usd +=
      (uncached * rate.input + tokens.cachedTokens * rate.cached + tokens.outputTokens * rate.output) /
      1_000_000;
  }
  return Math.round(usd * FX_CLP_PER_USD);
}
