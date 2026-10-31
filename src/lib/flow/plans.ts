import { AGENT_CATALOG, AGENT_ORDER, type AgentId } from "@/lib/catalog";
import { TRIAL_DAYS } from "@/lib/subscription";

export function priceWithIva(netClp: number) {
  return Math.round((netClp * 119) / 100);
}

export function planFor(agent: AgentId) {
  const definition = AGENT_CATALOG[agent];
  const planId =
    agent === "WHATSAPP" ? "brazo-whatsapp" : agent === "QUOTES" ? "brazo-cotizador" : "brazo-marketing";
  return {
    agent,
    planId,
    name: definition.name,
    netClp: definition.priceClp,
    amountClp: priceWithIva(definition.priceClp),
    trialDays: TRIAL_DAYS,
  };
}

export function agentForPlanId(planId: string): AgentId | null {
  for (const agent of AGENT_ORDER) {
    if (planFor(agent).planId === planId) return agent;
  }
  return null;
}

export function agentForAmount(amountClp: number): AgentId | null {
  const matches = AGENT_ORDER.filter((agent) => planFor(agent).amountClp === amountClp);
  return matches.length === 1 ? matches[0] : null;
}

export function flowRedirectUrl(url: string, token: string) {
  const clean = url.trim();
  if (!clean || !token.trim()) return null;
  if (/[?&]token=/.test(clean)) return clean;
  const join = clean.includes("?") ? "&" : "?";
  return `${clean}${join}token=${encodeURIComponent(token.trim())}`;
}

export function trialDaysToAsk(
  existing: { flowSubscriptionId: string | null; periodEnd: Date } | null,
  now = new Date(),
) {
  if (!existing) return TRIAL_DAYS;
  if (existing.flowSubscriptionId) return 0;
  if (existing.periodEnd.getTime() <= now.getTime()) return 0;
  const remaining = Math.ceil((existing.periodEnd.getTime() - now.getTime()) / 86_400_000);
  return Math.min(TRIAL_DAYS, Math.max(1, remaining));
}
