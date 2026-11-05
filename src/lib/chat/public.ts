import { PLAN_LIMIT_MESSAGE } from "@/lib/plan-copy";

export type PublicAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type PublicMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  kind: "TEXT" | "CONFIRMATION";
  body: string;
  action: string;
  actionTitle: string;
  confirmation: "PENDING" | "APPROVED" | "CANCELED" | null;
  createdAt: string;
  attachments: PublicAttachment[];
};

export type ChatClientEvent =
  | { type: "status"; text: string }
  | { type: "user"; message: PublicMessage }
  | { type: "delta"; text: string }
  | { type: "message"; message: PublicMessage }
  | { type: "replace"; message: PublicMessage }
  | { type: "usage"; consults: number }
  | { type: "done" }
  | { type: "error"; code: string };

export const ACTION_HELP =
  "Si apruebas, dejo el borrador. Declarar o pagar no corre sin esta confirmación. Las claves se usan desde la Bóveda, sin mostrarlas.";

export const CHAT_ERROR: Record<string, string> = {
  sesion: "Tu sesión venció. Vuelve a ingresar.",
  csrf: "Recarga la página e intenta de nuevo.",
  limite: PLAN_LIMIT_MESSAGE,
  suscripcion: "Activa la prueba o la suscripción de este agente para conversar.",
  suspendida: "Tu empresa está suspendida. Los agentes están detenidos.",
  datos: "Escribe un mensaje o adjunta un archivo.",
  ia: "No alcancé a responder. No descontamos esta vez.",
  ritmo: "Demasiados mensajes seguidos. Espera un momento.",
  archivo: "Ese archivo no se puede adjuntar. Usa una imagen, un PDF o un texto de hasta 5 MB.",
  migracion: "Falta actualizar la base para el chat.",
  voz: "No pude usar el micrófono. Revisa el permiso del navegador.",
  confirmacion: "Esa confirmación ya no está pendiente.",
};
