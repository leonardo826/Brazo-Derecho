import { renderMockTask } from "@/lib/xai/mock";
import type { XaiTask } from "@/lib/xai/types";

export function taskInput(task: XaiTask, businessName?: string) {
  const facts = renderMockTask(task);
  const lines = [
    businessName?.trim() ? `Negocio: ${businessName.trim()}.` : "",
    "Redacta la respuesta final en español de Chile.",
    "Usa únicamente los datos de abajo. No agregues precios, plazos, descuentos ni datos que no aparezcan.",
    "No menciones Grok, xAI ni el nombre de un modelo.",
    "Datos:",
    facts,
  ];
  return lines.filter(Boolean).join("\n");
}
