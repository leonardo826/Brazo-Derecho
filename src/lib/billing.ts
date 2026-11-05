import { FX_CLP_PER_USD, MODEL_RATES, type TokenUsage } from "@/lib/pricing";
import { iabotPriceClp } from "@/lib/subscription";

/**
 * Tarifas de trabajo para el estimado de cobro.
 * grok-4.3 y grok-4.7: mismos supuestos que `MODEL_RATES` (29 de octubre de 2026).
 * Hay que refrescarlas desde https://docs.x.ai cuando xAI publique otra tabla.
 * No es una tarifa en vivo y el dólar no es el tipo de cambio del día.
 * Un modelo que no esté en la tabla usa la tarifa de grok-4.7.
 */
export const CLIENT_PRICE_MULTIPLIER = 2;

export const METER_KINDS = ["TASK", "CHAT", "COMPUTER_STEP"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

export type UsageMonthTotals = {
  tasksCount: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

export type MeterDraft = {
  kind: MeterKind;
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  synthetic?: boolean;
};

export type MeterBucket = {
  model: string;
  synthetic: boolean;
  kind: MeterKind;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

export type MonthBill = {
  yearMonth: string;
  label: string;
  tasks: number;
  tokens: TokenUsage;
  apiTokens: TokenUsage;
  simulatorTokens: TokenUsage;
  byModel: { model: string; tokens: TokenUsage }[];
  xaiUsd: number;
  computerUsd: number;
  realUsd: number;
  clientUsd: number;
  clientClp: number;
  fx: number;
  fixedPriceClp: number | null;
};

const EMPTY_TOKENS: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export const EMPTY_USAGE_MONTH: UsageMonthTotals = {
  tasksCount: 0,
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
};

type EnvLike = Record<string, string | undefined>;

function nonNegativeInt(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function sanitizeTokens(tokens: Partial<TokenUsage> | undefined): TokenUsage {
  const inputTokens = nonNegativeInt(tokens?.inputTokens);
  const outputTokens = nonNegativeInt(tokens?.outputTokens);
  const cachedTokens = Math.min(inputTokens, nonNegativeInt(tokens?.cachedTokens));
  return { inputTokens, cachedTokens, outputTokens };
}

export function applyMeterEvent(month: UsageMonthTotals, event: MeterDraft): UsageMonthTotals {
  const tokens = sanitizeTokens(event);
  return {
    tasksCount: month.tasksCount + (event.kind === "TASK" ? 1 : 0),
    inputTokens: month.inputTokens + tokens.inputTokens,
    cachedTokens: month.cachedTokens + tokens.cachedTokens,
    outputTokens: month.outputTokens + tokens.outputTokens,
  };
}

function readOptionalRate(env: EnvLike, key: string) {
  const raw = env[key]?.trim() ?? "";
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function readNonNegative(env: EnvLike, key: string, fallback: number) {
  const value = readOptionalRate(env, key);
  return value ?? fallback;
}

export function fixedShelfPriceClp(env: EnvLike = process.env) {
  return iabotPriceClp(env.IABOT_PRICE_CLP ?? "");
}

type ModelRate = { input: number; cached: number; output: number };

function baseRate(model: string): ModelRate {
  if (model === "grok-4.3" || model === "grok-4.7") return MODEL_RATES[model];
  return MODEL_RATES["grok-4.7"];
}

export function rateForModel(model: string, env: EnvLike = process.env): ModelRate {
  const base = baseRate(model);
  return {
    input: readOptionalRate(env, "USAGE_USD_PER_M_INPUT") ?? base.input,
    cached: readOptionalRate(env, "USAGE_USD_PER_M_CACHED") ?? base.cached,
    output: readOptionalRate(env, "USAGE_USD_PER_M_OUTPUT") ?? base.output,
  };
}

export function tokenCostUsd(tokens: TokenUsage, rate: ModelRate) {
  const clean = sanitizeTokens(tokens);
  const uncached = clean.inputTokens - clean.cachedTokens;
  return (uncached * rate.input + clean.cachedTokens * rate.cached + clean.outputTokens * rate.output) / 1_000_000;
}

function addTokens(left: TokenUsage, right: TokenUsage): TokenUsage {
  return sanitizeTokens({
    inputTokens: left.inputTokens + right.inputTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  });
}

export function splitMeterBuckets(buckets: MeterBucket[]) {
  let apiTokens = { ...EMPTY_TOKENS };
  let simulatorTokens = { ...EMPTY_TOKENS };
  const byModel = new Map<string, TokenUsage>();
  for (const bucket of buckets) {
    const tokens = sanitizeTokens(bucket);
    if (bucket.synthetic) {
      simulatorTokens = addTokens(simulatorTokens, tokens);
      continue;
    }
    apiTokens = addTokens(apiTokens, tokens);
    const model = bucket.model.trim() || "grok-4.7";
    byModel.set(model, addTokens(byModel.get(model) ?? EMPTY_TOKENS, tokens));
  }
  return {
    apiTokens,
    simulatorTokens,
    byModel: [...byModel.entries()].map(([model, tokens]) => ({ model, tokens })),
  };
}

/**
 * El cliente paga el doble del costo real (computador en la nube + xAI).
 * `tasks` queda en la firma para el panel: no tiene precio unitario.
 * `fx` lo entrega quien llama (por defecto el dólar de trabajo, no un tipo de cambio en vivo).
 */
export function estimateClientPriceClp(input: {
  tasks: number;
  tokens: TokenUsage;
  fx: number;
  computerUsd: number;
  byModel?: { model: string; tokens: TokenUsage }[];
  env?: EnvLike;
}) {
  const env = input.env ?? process.env;
  const fx = Number.isFinite(input.fx) ? Math.max(0, input.fx) : 0;
  const computerUsd = Number.isFinite(input.computerUsd) ? Math.max(0, input.computerUsd) : 0;
  const rows = input.byModel?.filter((row) => {
    const tokens = sanitizeTokens(row.tokens);
    return tokens.inputTokens > 0 || tokens.outputTokens > 0;
  });
  const xaiUsd =
    rows && rows.length > 0
      ? rows.reduce((sum, row) => sum + tokenCostUsd(row.tokens, rateForModel(row.model, env)), 0)
      : tokenCostUsd(input.tokens, rateForModel("grok-4.7", env));
  const realUsd = xaiUsd + computerUsd;
  const clientUsd = realUsd * CLIENT_PRICE_MULTIPLIER;
  return {
    tasks: nonNegativeInt(input.tasks),
    xaiUsd,
    computerUsd,
    realUsd,
    clientUsd,
    clientClp: Math.round(clientUsd * fx),
    fx,
  };
}

export function buildMonthBill(input: {
  yearMonth: string;
  label: string;
  month: UsageMonthTotals | null;
  buckets: MeterBucket[];
  env?: EnvLike;
}): MonthBill {
  const env = input.env ?? process.env;
  const month = input.month ?? EMPTY_USAGE_MONTH;
  const split = splitMeterBuckets(input.buckets);
  const fx = readNonNegative(env, "USAGE_FX_CLP_PER_USD", FX_CLP_PER_USD);
  const computerUsd = readNonNegative(env, "USAGE_COMPUTER_USD", 0);
  const price = estimateClientPriceClp({
    tasks: month.tasksCount,
    tokens: split.apiTokens,
    fx,
    computerUsd,
    byModel: split.byModel,
    env,
  });
  return {
    yearMonth: input.yearMonth,
    label: input.label,
    tasks: month.tasksCount,
    tokens: {
      inputTokens: month.inputTokens,
      cachedTokens: month.cachedTokens,
      outputTokens: month.outputTokens,
    },
    apiTokens: split.apiTokens,
    simulatorTokens: split.simulatorTokens,
    byModel: split.byModel,
    xaiUsd: price.xaiUsd,
    computerUsd: price.computerUsd,
    realUsd: price.realUsd,
    clientUsd: price.clientUsd,
    clientClp: price.clientClp,
    fx,
    fixedPriceClp: fixedShelfPriceClp(env),
  };
}

/** Empresa de prueba: el estimado queda en cero y no muestra precio de vitrina. */
export function billWithoutCharges(bill: MonthBill): MonthBill {
  const zero = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
  return {
    ...bill,
    tasks: 0,
    tokens: { ...zero },
    apiTokens: { ...zero },
    simulatorTokens: { ...zero },
    byModel: [],
    xaiUsd: 0,
    computerUsd: 0,
    realUsd: 0,
    clientUsd: 0,
    clientClp: 0,
    fixedPriceClp: null,
  };
}
