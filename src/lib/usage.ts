import { AGENT_CATALOG, AGENT_ORDER, METRIC_LABEL, type AgentId, type MetricId, type ModelId } from "@/lib/catalog";
import { EMPTY_USAGE, estimateCostClp, type TokenUsage } from "@/lib/pricing";

export type UsageSlice = {
  agent: AgentId;
  metric: MetricId;
  quantity: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  model?: string | null;
};

export function evaluateLimit(used: number, quantity: number, limit: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("La cantidad de uso tiene que ser un entero mayor que cero");
  }
  if (!Number.isInteger(used) || used < 0 || !Number.isInteger(limit) || limit < 1) {
    throw new Error("El límite de uso no es válido");
  }
  const remaining = Math.max(0, limit - used);
  if (used + quantity > limit) {
    return { ok: false as const, used, limit, remaining };
  }
  return {
    ok: true as const,
    used: used + quantity,
    limit,
    remaining: limit - used - quantity,
  };
}

function zoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  if (map.hour === 24) map.hour = 0;
  return map;
}

function offsetMs(date: Date, timeZone: string) {
  const map = zoneParts(date, timeZone);
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUtc - date.getTime();
}

function zonedMidnight(year: number, month: number, timeZone: string) {
  const guess = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

export function dayStart(now = new Date(), timeZone = "America/Santiago") {
  const map = zoneParts(now, timeZone);
  const guess = new Date(Date.UTC(map.year, map.month - 1, map.day, 0, 0, 0));
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

export function monthBounds(now = new Date(), timeZone = "America/Santiago") {
  const map = zoneParts(now, timeZone);
  const start = zonedMidnight(map.year, map.month, timeZone);
  const nextMonth = map.month === 12 ? 1 : map.month + 1;
  const nextYear = map.month === 12 ? map.year + 1 : map.year;
  const end = zonedMidnight(nextYear, nextMonth, timeZone);
  return {
    start,
    end,
    label: new Intl.DateTimeFormat("es-CL", { timeZone, month: "long", year: "numeric" }).format(now),
  };
}

export const USAGE_WARN_AT = 0.8;

export type UsageAlert = {
  agent: AgentId;
  metric: MetricId;
  used: number;
  limit: number;
  percent: number;
};

export function usageAlerts(totals: Record<MetricId, number>) {
  const alerts: UsageAlert[] = [];
  for (const agent of AGENT_ORDER) {
    for (const [metric, limit] of Object.entries(AGENT_CATALOG[agent].limits) as [MetricId, number][]) {
      const used = totals[metric] ?? 0;
      if (!limit || used / limit < USAGE_WARN_AT) continue;
      const percent = used >= limit ? 100 : Math.floor((used / limit) * 100);
      alerts.push({ agent, metric, used, limit, percent });
    }
  }
  return alerts;
}

export function usageAlertMessage(alert: Pick<UsageAlert, "agent" | "metric" | "percent">) {
  const name = AGENT_CATALOG[alert.agent].name;
  const metric = METRIC_LABEL[alert.metric].toLowerCase();
  if (alert.percent >= 100) {
    return `Ya usaste el cupo de ${metric} de ${name} este mes. El agente queda pausado hasta el próximo mes para no seguir gastando.`;
  }
  return `Vas al ${alert.percent}% del cupo de ${metric} de ${name}. Si llegas al 100%, ese agente se pausa hasta el próximo mes para no seguir gastando.`;
}

export function monthKey(now = new Date(), timeZone = "America/Santiago") {
  const map = zoneParts(now, timeZone);
  return `${map.year}-${String(map.month).padStart(2, "0")}`;
}

export function monthQueryDate(raw: string | undefined, now = new Date()) {
  const match = raw?.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return now;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return now;
  }
  return new Date(Date.UTC(year, month - 1, 15, 16, 0, 0));
}

export function summarizeUsage(events: UsageSlice[]) {
  const totals: Record<MetricId, number> = { RESPONSES: 0, QUOTES: 0, TEXTS: 0, IMAGES: 0 };
  const byModel: Record<ModelId, TokenUsage> = {
    "grok-4.3": { ...EMPTY_USAGE },
    "grok-4.7": { ...EMPTY_USAGE },
  };
  for (const event of events) {
    totals[event.metric] += event.quantity;
    const model =
      event.model === "grok-4.3" || event.model === "grok-4.7" ? event.model : AGENT_CATALOG[event.agent].model;
    byModel[model].inputTokens += event.inputTokens;
    byModel[model].cachedTokens += event.cachedTokens;
    byModel[model].outputTokens += event.outputTokens;
  }
  return {
    totals,
    byModel,
    imageCount: totals.IMAGES,
    costClp: estimateCostClp(byModel, totals.IMAGES),
  };
}
