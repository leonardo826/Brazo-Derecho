import { createHash } from "node:crypto";
import type { AgentKind } from "@/lib/prisma";
import { containsBlockedSecret } from "@/lib/memory/filter";

export const MEMORY_CONTEXT_TOKEN_BUDGET = 480;
export const MEMORY_ACTIVE_LIMIT = 100;
export const MEMORY_HEADER =
  "Datos que ya conoces de esta empresa. Úsalos si vienen al caso. No los contradigas ni los inventes. No los menciones si no aportan.";

const STOP = new Set([
  "empresa",
  "para",
  "como",
  "este",
  "esta",
  "esto",
  "tiene",
  "tienen",
  "sobre",
  "desde",
  "hasta",
  "donde",
  "cuando",
  "porque",
  "tambien",
  "también",
]);

export type FactScope = "empresa" | "agente";

export type FactCandidate = {
  text: string;
  scope: FactScope;
};

export type StoredFact = {
  id: string;
  text: string;
  contentHash: string;
  deletedAt: Date | null;
};

export type RankedFact = {
  id: string;
  text: string;
  agent: AgentKind | null;
  updatedAt: Date;
};

export type PlannedFact = {
  organizationId: string;
  agent: AgentKind | null;
  text: string;
  contentHash: string;
  sourceConversationId: string | null;
};

export type FactPlan = {
  inserts: PlannedFact[];
  replacements: { id: string; text: string; contentHash: string }[];
};

export function estimateTokens(text: string) {
  const clean = text.trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}

export function normalizeFact(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function factHash(text: string) {
  return createHash("sha256").update(normalizeFact(text)).digest("hex");
}

function words(text: string) {
  return normalizeFact(text)
    .split(" ")
    .filter((word) => word.length > 2);
}

export function isNearDuplicate(candidate: string, existing: string) {
  const left = normalizeFact(candidate);
  const right = normalizeFact(existing);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftWords = new Set(words(left));
  const rightWords = new Set(words(right));
  if (leftWords.size === 0 || rightWords.size === 0) return false;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  const union = leftWords.size + rightWords.size - shared;
  return union > 0 && shared / union >= 0.8;
}

function longerContains(next: string, previous: string) {
  const left = words(next);
  const right = words(previous);
  if (right.length < 3 || left.length <= right.length) return false;
  const bag = new Set(left);
  return right.every((word) => bag.has(word));
}

function relevance(fact: string, query: string) {
  const queryWords = new Set(words(query).filter((word) => word.length >= 4 && !STOP.has(word)));
  if (queryWords.size === 0) return 0;
  const factWords = words(fact).filter((word) => word.length >= 4 && !STOP.has(word));
  if (factWords.length === 0) return 0;
  let shared = 0;
  for (const word of factWords) if (queryWords.has(word)) shared += 1;
  return shared / Math.sqrt(factWords.length);
}

export function selectFactsForPrompt(facts: RankedFact[], query: string, budget = MEMORY_CONTEXT_TOKEN_BUDGET) {
  const ranked = [...facts].sort((left, right) => {
    const score = relevance(right.text, query) - relevance(left.text, query);
    if (score !== 0) return score;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
  const picked: RankedFact[] = [];
  let used = estimateTokens(MEMORY_HEADER);
  for (const fact of ranked) {
    const cost = estimateTokens(`- ${fact.text}`) + 1;
    if (used + cost > budget) continue;
    picked.push(fact);
    used += cost;
  }
  return picked;
}

export function formatMemoryContext(facts: { text: string }[]) {
  if (facts.length === 0) return "";
  return [MEMORY_HEADER, ...facts.map((fact) => `- ${fact.text}`)].join("\n");
}

export function cleanFactText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function parseMemoryPayload(raw: string): FactCandidate[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || !("hechos" in parsed) || !Array.isArray(parsed.hechos)) return [];
  const facts: FactCandidate[] = [];
  for (const item of parsed.hechos) {
    if (!item || typeof item !== "object" || !("texto" in item) || typeof item.texto !== "string") continue;
    const text = cleanFactText(item.texto);
    if (text.length < 8) continue;
    const scope = "alcance" in item && item.alcance === "agente" ? "agente" : "empresa";
    facts.push({ text, scope });
    if (facts.length >= 6) break;
  }
  return facts;
}

/** Borrado real: el texto personal sale y la fila queda marcada. El hash no se toca. */
export function erasedFactData(now = new Date()) {
  return { deletedAt: now, text: "" };
}

export function planMemoryWrites(input: {
  existing: StoredFact[];
  candidates: FactCandidate[];
  agent: AgentKind;
  organizationId: string;
  sourceConversationId: string | null;
  activeLimit?: number;
}): FactPlan {
  const active = input.existing
    .filter((row) => row.deletedAt === null && row.text.trim())
    .map((row) => ({ ...row }));
  const blocked = new Set(input.existing.map((row) => row.contentHash));
  let room = (input.activeLimit ?? MEMORY_ACTIVE_LIMIT) - active.length;
  const inserts: PlannedFact[] = [];
  const replacements: FactPlan["replacements"] = [];
  const batchTexts: string[] = [];

  for (const candidate of input.candidates) {
    const text = cleanFactText(candidate.text);
    if (text.length < 8) continue;
    if (containsBlockedSecret(text)) continue;
    const hash = factHash(text);
    if (blocked.has(hash)) continue;
    if (active.some((row) => isNearDuplicate(text, row.text) && !longerContains(text, row.text))) continue;
    if (batchTexts.some((previous) => isNearDuplicate(text, previous))) continue;

    const shorter = active.find((row) => longerContains(text, row.text));
    if (shorter) {
      replacements.push({ id: shorter.id, text, contentHash: hash });
      blocked.add(hash);
      shorter.text = text;
      shorter.contentHash = hash;
      batchTexts.push(text);
      continue;
    }
    if (room <= 0) continue;
    blocked.add(hash);
    room -= 1;
    batchTexts.push(text);
    inserts.push({
      organizationId: input.organizationId,
      agent: candidate.scope === "agente" ? input.agent : null,
      text,
      contentHash: hash,
      sourceConversationId: input.sourceConversationId,
    });
  }
  return { inserts, replacements };
}
