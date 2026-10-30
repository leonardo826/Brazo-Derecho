export type AgentId = "WHATSAPP" | "QUOTES" | "MARKETING";
export type MetricId = "RESPONSES" | "QUOTES" | "TEXTS" | "IMAGES";
export type ModelId = "grok-4.3" | "grok-4.7";

export type AgentDefinition = {
  id: AgentId;
  name: string;
  priceClp: number;
  model: ModelId;
  limits: Partial<Record<MetricId, number>>;
  limitLabel: string;
  tagline: string;
  does: string[];
  doesNot: string[];
  instructions: string;
};

export const AGENT_ORDER: AgentId[] = ["WHATSAPP", "QUOTES", "MARKETING"];

export const AGENT_CATALOG: Record<AgentId, AgentDefinition> = {
  WHATSAPP: {
    id: "WHATSAPP",
    name: "Atención WhatsApp",
    priceClp: 39990,
    model: "grok-4.3",
    limits: { RESPONSES: 1000 },
    limitLabel: "1.000 respuestas al mes",
    tagline: "Responde con lo que ya está escrito en tu negocio.",
    does: [
      "Contesta horarios, dirección, despachos y preguntas frecuentes",
      "Deriva a una persona cuando no tiene la información",
      "Deja el hilo guardado en tu panel",
    ],
    doesNot: [
      "No cobra ni pide datos de tarjeta",
      "No promete descuentos",
      "No da asesoría legal ni médica",
      "No manda publicidad masiva",
    ],
    instructions: [
      "Eres el agente de atención de una pyme chilena.",
      "Responde solo con la ficha que te entreguen. Si no está, di que una persona del equipo va a responder.",
      "No inventes horarios, precios, stock ni políticas.",
      "No ofrezcas descuentos, no cobres, no pidas tarjetas, no des asesoría legal ni médica y no envíes publicidad masiva.",
      "Habla en español de Chile, cercano y breve.",
      "No menciones Grok, xAI ni el nombre de un modelo.",
    ].join(" "),
  },
  QUOTES: {
    id: "QUOTES",
    name: "Cotizador",
    priceClp: 49990,
    model: "grok-4.7",
    limits: { QUOTES: 300 },
    limitLabel: "300 cotizaciones al mes",
    tagline: "Arma la cotización con tu lista. Tú la apruebas.",
    does: [
      "Arma cotizaciones solo con los precios de tu lista",
      "Calcula el total y deja un PDF para revisar",
      "Deja fuera lo que no está en la lista",
    ],
    doesNot: [
      "No inventa precios",
      "No envía la cotización al cliente",
      "No emite factura ni boleta",
    ],
    instructions: [
      "Eres el agente cotizador de una pyme chilena.",
      "Los precios y el total ya vienen calculados desde la lista. No los cambies ni completes productos que no te hayan pasado.",
      "El texto es una nota interna para quien aprueba. No digas que la cotización ya fue enviada.",
      "Habla en español de Chile.",
      "No menciones Grok, xAI ni el nombre de un modelo.",
    ].join(" "),
  },
  MARKETING: {
    id: "MARKETING",
    name: "Marketing",
    priceClp: 34990,
    model: "grok-4.7",
    limits: { TEXTS: 60, IMAGES: 30 },
    limitLabel: "60 textos y 30 imágenes al mes",
    tagline: "Deja textos e imágenes en borrador. Tú publicas.",
    does: [
      "Propone textos para Instagram, Facebook, historias y la ficha de Google",
      "Arma una imagen borrador a partir de tu perfil de marca",
      "Deja todo pendiente de tu revisión",
    ],
    doesNot: ["No publica solo", "No compra avisos", "No responde comentarios"],
    instructions: [
      "Eres el agente de marketing de una pyme chilena.",
      "Escribes borradores para que una persona los publique. Nunca digas que ya quedaron publicados.",
      "Usa solo el perfil de marca que te pasen. No inventes promociones, descuentos ni precios.",
      "Habla en español de Chile, claro y concreto.",
      "No menciones Grok, xAI ni el nombre de un modelo.",
    ].join(" "),
  },
};

export const METRIC_LABEL: Record<MetricId, string> = {
  RESPONSES: "Respuestas",
  QUOTES: "Cotizaciones",
  TEXTS: "Textos",
  IMAGES: "Imágenes",
};

export function isAgentId(value: string): value is AgentId {
  return value === "WHATSAPP" || value === "QUOTES" || value === "MARKETING";
}

export function limitFor(agent: AgentId, metric: MetricId): number {
  const limit = AGENT_CATALOG[agent].limits[metric];
  if (!limit) {
    throw new Error(`La métrica ${metric} no corresponde a ${agent}`);
  }
  return limit;
}
