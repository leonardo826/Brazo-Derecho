import { normalizeText, tokens } from "@/lib/text";

const UNIT_WORDS = new Set([
  "unidad",
  "unidades",
  "galon",
  "galones",
  "litro",
  "litros",
  "kilo",
  "kilos",
  "caja",
  "cajas",
  "metro",
  "metros",
  "saco",
  "sacos",
  "bolsa",
  "bolsas",
  "par",
  "pares",
  "taza",
  "tazas",
  "porcion",
  "porciones",
]);

export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  priceClp: number;
  active: boolean;
};

export type BuiltLine = {
  priceItemId: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceClp: number;
};

function compact(value: string) {
  return normalizeText(value).replace(/ /g, "");
}

function significantTokens(name: string) {
  return tokens(name).filter((token) => token.length >= 4 && !UNIT_WORDS.has(token) && !/^\d+$/.test(token));
}

function nameMatches(normalizedRequest: string, item: CatalogItem) {
  const sku = compact(item.sku);
  if (sku.length >= 3 && compact(normalizedRequest).includes(sku)) return true;
  const significant = significantTokens(item.name);
  if (significant.length === 0) return false;
  return significant.every((token) => normalizedRequest.includes(token));
}

function quantityNear(normalizedRequest: string, name: string) {
  const anchor = significantTokens(name)[0];
  if (!anchor) return 1;
  const index = normalizedRequest.indexOf(anchor);
  if (index < 0) return 1;
  const window = normalizedRequest.slice(Math.max(0, index - 24), index + anchor.length + 16);
  const numbers = [...window.matchAll(/\d+/g)]
    .map((match) => Number(match[0]))
    .filter((value) => value >= 1 && value <= 999);
  return numbers[0] ?? 1;
}

export function matchFreeText(request: string, catalog: CatalogItem[]) {
  const normalized = normalizeText(request);
  if (!normalized) return [];
  const matches: { priceItemId: string; quantity: number }[] = [];
  for (const item of catalog) {
    if (!item.active) continue;
    if (!nameMatches(normalized, item)) continue;
    matches.push({ priceItemId: item.id, quantity: quantityNear(normalized, item.name) });
  }
  return matches;
}

export function buildQuoteLines(
  requested: { priceItemId: string; quantity: number }[],
  catalog: CatalogItem[],
) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const merged = new Map<string, number>();
  let rejected = 0;
  for (const row of requested) {
    const item = byId.get(row.priceItemId);
    const quantity = row.quantity;
    if (!item || !item.active || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      rejected += 1;
      continue;
    }
    merged.set(item.id, Math.min(999, (merged.get(item.id) ?? 0) + quantity));
  }
  const lines: BuiltLine[] = [...merged.entries()].map(([id, quantity]) => {
    const item = byId.get(id)!;
    return {
      priceItemId: item.id,
      description: item.name,
      unit: item.unit,
      quantity,
      unitPriceClp: item.priceClp,
    };
  });
  return { lines, rejected };
}

export function quoteTotal(lines: { quantity: number; unitPriceClp: number }[]) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceClp, 0);
}
