import { consumeRateLimit } from "@/lib/rate-limit";

export const MEMORY_EXTRACTIONS_PER_WINDOW = 4;
export const MEMORY_EXTRACTION_WINDOW_MS = 10 * 60 * 1000;

export type MemoryAudience = "member" | "customer";

/** El cliente final de WhatsApp no alimenta la memoria. Solo lo que dijo un miembro, o el agente. */
export function textsForExtraction(input: { audience?: MemoryAudience; userText: string; assistantText: string }) {
  if (input.audience === "customer") return { userText: "", assistantText: input.assistantText };
  return { userText: input.userText, assistantText: input.assistantText };
}

export function isTrivialMemoryTurn(userText: string, assistantText: string) {
  const user = userText.replace(/\s+/g, " ").trim();
  const assistant = assistantText.replace(/\s+/g, " ").trim();
  const material = `${user} ${assistant}`.replace(/\s+/g, " ").trim();
  if (material.length < 24) return true;
  const greeting = user
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.!?,]+$/g, "");
  if (
    /^(hola|buenas|buenos dias|buenas tardes|buenas noches|gracias|ok|dale|chao|adios|si|no)$/.test(greeting) &&
    assistant.length < 80
  ) {
    return true;
  }
  return false;
}

export function memoryExtractionAllowed(organizationId: string, now = Date.now()) {
  return consumeRateLimit(
    `memoria:${organizationId}`,
    MEMORY_EXTRACTIONS_PER_WINDOW,
    MEMORY_EXTRACTION_WINDOW_MS,
    now,
  ).ok;
}

/** Apagada, el panel solo aparece si queda algo que borrar. */
export function memoryPanelVisible(enabled: boolean, factCount: number, missing = false) {
  if (missing) return enabled;
  if (enabled) return true;
  return factCount > 0;
}
