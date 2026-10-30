import { tokens } from "@/lib/text";

export type Knowledge = { id: string; title: string; body: string };

export type RefusalCode = "discount" | "legal" | "medical" | "payment" | "spam";

const REFUSALS: { code: RefusalCode; pattern: RegExp; reply: string }[] = [
  {
    code: "discount",
    pattern: /descuento|rebaja|m[aá]s barato|precio especial|2\s*x\s*1|reg[aá]lame/i,
    reply:
      "No puedo ofrecer descuentos ni cambiar precios. Si quieres un valor distinto, te derivo con una persona del equipo.",
  },
  {
    code: "legal",
    pattern: /asesor[ií]a legal|me pueden demandar|es legal|abogad[oa]|juicio|demanda/i,
    reply: "No doy asesoría legal. Puedo pedir que te contacte una persona del equipo.",
  },
  {
    code: "medical",
    pattern: /diagn[oó]stico|receta|qu[eé] pastilla|me duele|s[ií]ntoma|medicamento/i,
    reply: "No doy asesoría médica. Si se trata de salud, consulta con un profesional.",
  },
  {
    code: "payment",
    pattern:
      /p[aá]game|te pago|c[oó]brame|cobrame|link de pago|n[uú]mero de (?:la )?tarjeta|datos de (?:la )?tarjeta|env[ií]a(?:r)? (?:el )?cobro/i,
    reply:
      "No puedo cobrar ni recibir pagos por aquí. El pago se hace directo con la empresa, por los medios que ellos publican.",
  },
  {
    code: "spam",
    pattern: /mensajes masivos|publicidad masiva|a todos los contactos|m[aá]ndale a toda la base|spam/i,
    reply: "No envío publicidad masiva. Este canal es solo para atender consultas.",
  },
];

const STOP = new Set([
  "para",
  "como",
  "donde",
  "cual",
  "esta",
  "este",
  "esto",
  "esos",
  "esas",
  "los",
  "las",
  "una",
  "uno",
  "unos",
  "unas",
  "tiene",
  "tienen",
  "quiero",
  "pueden",
  "puede",
  "ustedes",
  "usted",
  "hola",
  "buenas",
  "buenos",
  "tardes",
  "dias",
  "dia",
  "que",
  "con",
  "por",
  "del",
  "mas",
  "sobre",
  "info",
  "informacion",
  "necesito",
  "saber",
  "favor",
  "gracias",
  "abren",
]);

const SYNONYMS: Record<string, string[]> = {
  abren: ["horario", "hora", "abierto"],
  cierra: ["horario", "cierre"],
  cierran: ["horario", "cierre"],
  ubicacion: ["direccion", "local"],
  llegan: ["despacho", "envio", "entrega"],
  envio: ["despacho", "entrega"],
  envian: ["despacho", "entrega"],
  despachan: ["despacho", "entrega"],
  pago: ["pagos", "medios"],
  pagan: ["pagos"],
  debito: ["pagos", "pago"],
  credito: ["pagos", "pago"],
  carta: ["menu", "carta"],
  menu: ["carta"],
};

function expandToken(token: string) {
  const forms = [token];
  if (token.endsWith("es") && token.length > 5) forms.push(token.slice(0, -2));
  if (token.endsWith("s") && token.length > 4) forms.push(token.slice(0, -1));
  for (const form of [...forms]) {
    const extra = SYNONYMS[form];
    if (extra) forms.push(...extra);
  }
  return forms;
}

export function detectRefusal(question: string) {
  for (const rule of REFUSALS) {
    if (rule.pattern.test(question)) return rule;
  }
  return null;
}

export function findKnowledge(question: string, items: Knowledge[]) {
  const questionTokens = [
    ...new Set(tokens(question).flatMap(expandToken).filter((token) => token.length >= 4 && !STOP.has(token))),
  ];
  if (questionTokens.length === 0) return null;
  let best: { item: Knowledge; score: number } | null = null;
  for (const item of items) {
    const title = new Set(tokens(item.title).flatMap(expandToken));
    const body = new Set(tokens(item.body).flatMap(expandToken));
    let score = 0;
    for (const token of questionTokens) {
      if (title.has(token)) score += 3;
      else if (body.has(token)) score += 1;
    }
    if (!best || score > best.score) best = { item, score };
  }
  if (!best || best.score < 3) return null;
  return best.item;
}

export type WhatsappDecision =
  | { kind: "refuse"; code: RefusalCode; reply: string }
  | { kind: "escalate" }
  | { kind: "answer"; item: Knowledge };

export function decideWhatsappReply(question: string, knowledge: Knowledge[]): WhatsappDecision {
  const refusal = detectRefusal(question);
  if (refusal) return { kind: "refuse", code: refusal.code, reply: refusal.reply };
  const hit = findKnowledge(question, knowledge);
  if (!hit) return { kind: "escalate" };
  return { kind: "answer", item: hit };
}
