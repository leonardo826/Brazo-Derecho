import { rejectMemoryFact } from "@/lib/memory/filter";
import type { FactCandidate } from "@/lib/memory/facts";
import { cleanFactText } from "@/lib/memory/facts";
import { formatRut, isValidRut } from "@/lib/rut";

function take(match: RegExpMatchArray | null) {
  const value = match?.[1]?.replace(/\s+/g, " ").trim().replace(/[,:;]+$/g, "");
  if (!value || value.length < 2 || value.length > 140) return "";
  return value;
}

/**
 * Lo que el simulador devuelve cuando no hay red. El modelo real usa el mismo JSON.
 * Solo saca datos durables de la empresa. Una clave en el turno no se copia.
 */
export function heuristicFacts(turn: string): FactCandidate[] {
  const facts: FactCandidate[] = [];
  const rut = turn.match(/\b(\d{1,2}(?:\.?\d{3}){2}-[\dkK]|\d{7,8}-[\dkK])\b/);
  if (rut && isValidRut(rut[1])) {
    facts.push({ text: `El RUT de la empresa es ${formatRut(rut[1])}.`, scope: "empresa" });
  }
  const name = take(
    turn.match(
      /(?:la empresa se llama|nos llamamos|raz[oó]n social(?: es)?|el nombre de la empresa es)\s+([^.\n;]{2,80})/i,
    ),
  );
  if (name) facts.push({ text: `La empresa se llama ${name}.`, scope: "empresa" });
  const rubro = take(turn.match(/(?:el rubro es|nuestro rubro es|nos dedicamos a|rubro:)\s+([^.\n;]{2,80})/i));
  if (rubro) facts.push({ text: `El rubro es ${rubro}.`, scope: "empresa" });
  const products = take(
    turn.match(/(?:vendemos|nuestros productos son|los productos son|productos:)\s+([^.\n;]{2,140})/i),
  );
  if (products) facts.push({ text: `Los productos son ${products}.`, scope: "empresa" });
  const tone = take(
    turn.match(/(?:el tono es|el tono de la marca es|prefieren un tono|preferimos un tono|tono:|voz:)\s+([^.\n;]{2,80})/i),
  );
  if (tone) facts.push({ text: `El tono que prefieren es ${tone}.`, scope: "agente" });
  const audience = take(turn.match(/p[uú]blico:\s+([^.\n;]{2,80})/i));
  if (audience) facts.push({ text: `El público es ${audience}.`, scope: "empresa" });
  const preference = take(turn.match(/(?:preferimos|la preferencia es|preferencias:)\s+([^.\n;]{2,140})/i));
  if (preference) facts.push({ text: `La preferencia es ${preference}.`, scope: "agente" });
  return facts
    .map((fact) => ({ ...fact, text: cleanFactText(fact.text) }))
    .filter((fact) => fact.text.length >= 8 && !rejectMemoryFact(fact.text))
    .slice(0, 6);
}

export function heuristicMemoryJson(turn: string) {
  return JSON.stringify({ hechos: heuristicFacts(turn).map((fact) => ({ texto: fact.text, alcance: fact.scope })) });
}
