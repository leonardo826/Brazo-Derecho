import type { PublicMessage } from "@/lib/chat/public";

/** Sustituye la burbuja local por el mensaje guardado, o actualiza uno que ya está en el hilo. */
export function replaceOptimisticUser(items: PublicMessage[], message: PublicMessage, localId = "") {
  const withoutLocal = localId ? items.filter((item) => item.id !== localId) : items;
  const index = withoutLocal.findIndex((item) => item.id === message.id);
  if (index < 0) return [...withoutLocal, message];
  const next = withoutLocal.slice();
  next[index] = message;
  return next;
}
