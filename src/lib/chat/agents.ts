import type { AgentId, MetricId } from "@/lib/catalog";
import { instructionsFor } from "@/lib/catalog";
import { accountantChatInstructions } from "@/lib/chat/accountant";

export type ChatAgentId = Exclude<AgentId, "QUOTES">;

export type ChatSurface = {
  agent: ChatAgentId;
  metric: MetricId;
  conversationId: string;
  ariaLabel: string;
  placeholder: string;
  emptyIntro: string;
  suggestions: readonly string[];
  limitNote: string;
  desktop: boolean;
  /** Piso de cada tramo. El cupo mensual sigue siendo una respuesta por turno. */
  outputTokens: number;
  outputRounds: number;
};

const SURFACES: Record<ChatAgentId, ChatSurface> = {
  ACCOUNTING: {
    agent: "ACCOUNTING",
    metric: "CONSULTS",
    conversationId: "contador",
    ariaLabel: "Conversación con el contador",
    placeholder: "Escribe al Contador…",
    emptyIntro: "Puedo ayudarte con el IVA, el F29 o un acceso. El hilo queda en tu empresa.",
    suggestions: [
      "Resume qué es el IVA en dos frases, sin consultar portales",
      "Explícame bien el F29",
      "Quiero guardar un acceso del SII en el formulario seguro",
    ],
    limitNote: "Llegaste al cupo de consultas de este mes. Puedes revisar el hilo.",
    desktop: true,
    outputTokens: 0,
    outputRounds: 1,
  },
  MARKETING: {
    agent: "MARKETING",
    metric: "TEXTS",
    conversationId: "marketing",
    ariaLabel: "Conversación con marketing",
    placeholder: "Escribe a Marketing…",
    emptyIntro: "Puedo proponerte posts, un calendario o el texto de una campaña. Nada se publica solo.",
    suggestions: [
      "Propón 3 ideas de post para esta semana",
      "Arma un calendario de redes para los próximos 7 días",
      "Escribe el texto de una campaña, en borrador, sin publicarlo",
    ],
    limitNote: "Llegaste al cupo de textos de este mes. Puedes revisar el hilo.",
    desktop: false,
    outputTokens: 3200,
    outputRounds: 4,
  },
  WHATSAPP: {
    agent: "WHATSAPP",
    metric: "RESPONSES",
    conversationId: "whatsapp",
    ariaLabel: "Conversación de atención",
    placeholder: "Escribe como el cliente…",
    emptyIntro: "Prueba la atención en esta pantalla. Todavía no hay WhatsApp conectado.",
    suggestions: [
      "Un cliente pregunta el horario del sábado",
      "Responde como atención: ¿hacen despacho?",
      "El cliente pide un descuento. Qué le digo",
    ],
    limitNote: "Llegaste al cupo de respuestas de este mes. Puedes revisar el hilo.",
    desktop: false,
    outputTokens: 500,
    outputRounds: 1,
  },
};

export function isChatAgent(value: string): value is ChatAgentId {
  return value === "ACCOUNTING" || value === "MARKETING" || value === "WHATSAPP";
}

export function chatSurface(agent: ChatAgentId) {
  return SURFACES[agent];
}

export function outputBudget(
  agent: ChatAgentId,
  pace: { maxOutputTokens: number; rounds: number; webSearch: boolean; reasoningEffort: "low" | "medium" },
) {
  const floor = chatSurface(agent);
  return {
    ...pace,
    maxOutputTokens: Math.max(pace.maxOutputTokens, floor.outputTokens),
    rounds: Math.max(pace.rounds, floor.outputRounds),
  };
}

export function marketingChatInstructions(organizationName: string) {
  return [
    instructionsFor("MARKETING", organizationName),
    "Estás en un chat continuo con quien lleva una pyme chilena. Hablas en español de Chile, de tú, claro y cercano.",
    "Sirves para ideas, textos de post, calendarios de redes sociales y copys de campaña. Entrega el borrador listo para revisar.",
    "Cada post lleva, en este orden: un gancho, el cuerpo, un llamado a la acción claro, de 3 a 6 hashtags pertinentes y una idea de imagen.",
    "Los hashtags son del rubro y, cuando calce, de la zona de la empresa (por ejemplo #Concepción). No uses etiquetas genéricas que servirían para cualquier negocio.",
    "En un calendario, cada día nombra el post y usa esa misma estructura.",
    "Usa el nombre de la empresa, sus productos y su zona. Si falta uno, haz una sola pregunta corta o di qué supusiste. No inventes un local genérico.",
    "No publiques. No digas que un post, una historia o un aviso ya quedó publicado. Publicar exige la aprobación de la persona.",
    "No gastes presupuesto de avisos, no compres publicidad y no actives campañas pagadas.",
    "No respondas comentarios ni mensajes de redes como si ya los hubieras enviado.",
    "No inventes promociones, descuentos ni precios que no estén en el perfil de marca.",
    "Usa el hilo anterior. El último mensaje manda. Responde en markdown simple, sin HTML.",
    "No menciones Grok, xAI ni el nombre de un modelo.",
  ].join("\n");
}

export function whatsappChatInstructions(organizationName: string) {
  return [
    instructionsFor("WHATSAPP", organizationName),
    "Esto es una prueba en la web: respondes como la atención al cliente de la empresa, en el mesón, no en un celular.",
    "No hay conexión a WhatsApp. No digas que enviaste, recibiste o leíste un mensaje de WhatsApp.",
    "Usa solo el nombre, el RUT y las fichas de la empresa. Si el dato no está, di que una persona del equipo va a responder y no inventes horarios, precios, stock ni dirección.",
    "Mensajes breves, en español de Chile, de tú o de usted según el cliente, sin más de tres frases.",
    "No cobres, no pidas tarjetas ni claves, no prometas descuentos que no estén escritos, no des asesoría legal ni médica y no mandes publicidad masiva.",
    "Usa el hilo anterior. El último mensaje manda. Responde en markdown simple, sin HTML.",
    "No menciones Grok, xAI ni el nombre de un modelo.",
  ].join("\n");
}

export function chatInstructions(agent: ChatAgentId, organizationName: string) {
  if (agent === "ACCOUNTING") return accountantChatInstructions(organizationName);
  if (agent === "MARKETING") return marketingChatInstructions(organizationName);
  return whatsappChatInstructions(organizationName);
}

export function marketingContext(input: { name: string; profile: { voice: string; audience: string; summary: string } | null }) {
  const name = input.name.trim() || "la empresa";
  if (!input.profile) {
    return `Empresa: ${name}. No hay perfil de marca: faltan la voz, los productos y la zona. Haz una sola pregunta corta o di qué supusiste. No publiques ni gastes presupuesto.`;
  }
  return [
    `Empresa: ${name}.`,
    `Voz: ${input.profile.voice}`,
    `Público y zona: ${input.profile.audience}`,
    `Productos y resumen: ${input.profile.summary}`,
    "Usa el nombre, los productos y la zona en cada texto. Si falta uno, haz una sola pregunta corta o di qué supusiste.",
  ].join("\n");
}

export function whatsappContext(input: { name: string; rut: string | null; knowledge: { title: string; body: string }[] }) {
  const fichas =
    input.knowledge.length === 0
      ? "No hay fichas. No inventes datos del negocio."
      : input.knowledge.map((item) => `- ${item.title}: ${item.body}`).join("\n");
  return [`Empresa: ${input.name || "sin nombre"}.`, `RUT: ${input.rut?.trim() || "no informado"}.`, "Fichas que sí puedes usar:", fichas].join("\n");
}
