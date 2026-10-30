import { formatClp } from "@/lib/format";
import type { XaiClient, XaiRequest, XaiResponse, XaiTask } from "@/lib/xai/types";

let sequence = 0;

export function renderMockTask(task: XaiTask) {
  switch (task.type) {
    case "whatsapp_refuse":
      return task.reply;
    case "whatsapp_answer":
      return `Te cuento sobre ${task.title}: ${task.body} Si necesitas otra cosa, escríbeme y lo vemos.`;
    case "whatsapp_escalate":
      return "Eso no está en la información que me dejó la empresa. Voy a dejar tu mensaje para que te responda una persona del equipo.";
    case "quote_note": {
      const outside = task.unmatched
        ? ` ${task.unmatched}`
        : " Todo lo cotizado sale de la lista de precios, sin valores inventados.";
      const lines = task.lineCount === 1 ? "quedó 1 línea" : `quedaron ${task.lineCount} líneas`;
      return `Nota interna para ${task.customerName}: ${lines}, por un total de ${formatClp(task.totalClp)}.${outside} Esta cotización no se envió. La tiene que aprobar una persona.`;
    }
    case "marketing_post": {
      const openings = [
        "Esta semana queremos contar algo simple.",
        "Un recordatorio breve para tu comunidad.",
        "Una idea para publicar cuando tú quieras.",
        "Texto listo para revisar, todavía en borrador.",
      ];
      const opening = openings[task.index % openings.length];
      return `${opening}\n\n${task.summary}\n\nSe lo contamos a ${task.audience}, con un tono ${task.voice}.\n\nCanal sugerido: ${task.channel}. No está publicado: lo subes tú si te parece.`;
    }
    case "marketing_image":
      return `Imagen cuadrada, luz natural, negocio local en Chile, sin logos de terceros ni texto pequeño. Tema: ${task.summary}. Canal: ${task.channel}.`;
    default: {
      const never: never = task;
      return never;
    }
  }
}

/**
 * Cliente de reemplazo. No abre sockets ni lee XAI_API_KEY.
 * La frase sale de la ficha que ya resolvió el servidor.
 */
export class MockXaiClient implements XaiClient {
  async respond(request: XaiRequest): Promise<XaiResponse> {
    if (!request.instructions.trim()) {
      throw new Error("El agente mock necesita instrucciones");
    }
    sequence += 1;
    return {
      id: `mock_${sequence}`,
      model: request.model,
      outputText: renderMockTask(request.task),
      usage: request.usage,
      mocked: true,
    };
  }
}
