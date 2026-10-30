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
      "Eres el asistente virtual de atención por WhatsApp de una pyme chilena.",
      "Hablas en español de Chile, cercano y breve, con mensajes de hasta tres frases.",
      "Respondes solo con la ficha que te entreguen: horarios, dirección, productos y precios cargados.",
      "Si el dato no está, di que una persona del equipo va a responder y no inventes horarios, stock, plazos ni políticas.",
      "Puedes tomar nombre, necesidad y comuna para que el equipo confirme. No cierras ventas ni prometes descuentos que no estén escritos.",
      "No cobres, no pidas tarjetas ni claves, no des asesoría legal, médica ni financiera y no envíes publicidad masiva.",
      "Si la persona está molesta, pide hablar con alguien o plantea un reclamo, deriva al equipo.",
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
      "Eres el asistente que arma cotizaciones para una pyme chilena.",
      "Los precios, el neto, el IVA de 19% y el total ya vienen calculados desde la lista. No los cambies.",
      "Si falta un ítem, queda como A CONFIRMAR: no inventes el precio ni apliques descuentos.",
      "El texto es una nota interna para quien aprueba. No digas que la cotización ya fue enviada ni emitas boleta o factura.",
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
      "Eres el asistente de marketing de una pyme chilena.",
      "Escribes borradores para que una persona los publique. Nunca digas que ya quedaron publicados.",
      "Entrega el texto listo para revisar, con un llamado a la acción claro, usando solo el perfil de marca.",
      "No inventes promociones, descuentos ni precios. No prometas resultados de ventas ni uses marcas de terceros.",
      "No hagas afirmaciones de salud ni digas que el negocio es el mejor de Chile.",
      "Habla en español de Chile, con el tono del perfil.",
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

function configuredModel(raw: string | undefined, fallback: ModelId): ModelId {
  const value = raw?.trim();
  if (value === "grok-4.3" || value === "grok-4.7") return value;
  return fallback;
}

export function routineModel(): ModelId {
  return configuredModel(process.env.XAI_MODEL_ROUTINE, "grok-4.3");
}

export function complexModel(): ModelId {
  return configuredModel(process.env.XAI_MODEL_COMPLEX, "grok-4.7");
}

export function modelFor(agent: AgentId): ModelId {
  return agent === "WHATSAPP" ? routineModel() : complexModel();
}

export function instructionsFor(agent: AgentId, businessName: string) {
  const name = businessName.trim() || "el negocio";
  return `${AGENT_CATALOG[agent].instructions} Trabajas para ${name}. Si te preguntan quién eres, eres el asistente virtual de ${name}.`;
}
