import type { PublicMessage } from "@/lib/chat/public";

/** Replaces the optimistic bubble in place so later queued messages stay below it. */
export function replaceOptimisticUser(items: PublicMessage[], message: PublicMessage, localId = "") {
  const localIndex = localId ? items.findIndex((item) => item.id === localId) : -1;
  const withoutLocal = localIndex >= 0 ? items.filter((item) => item.id !== localId) : items;
  const index = withoutLocal.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    const next = withoutLocal.slice();
    next[index] = message;
    return next;
  }
  if (localIndex >= 0) {
    const next = withoutLocal.slice();
    next.splice(Math.min(localIndex, next.length), 0, message);
    return next;
  }
  return [...withoutLocal, message];
}

/** Keeps an in-flight answer above messages that are still waiting to be sent. */
export function placeThreadMessage(
  items: PublicMessage[],
  message: PublicMessage,
  localId: string,
  queuedIds: readonly string[],
) {
  const replaced = replaceOptimisticUser(items, message, localId);
  if (message.role === "USER") return replaced;
  return insertBeforeQueue(replaced, message, queuedIds);
}

export function insertBeforeQueue(items: PublicMessage[], message: PublicMessage, queuedIds: readonly string[]) {
  const existing = items.findIndex((item) => item.id === message.id);
  if (queuedIds.length === 0) {
    return existing >= 0 ? items : [...items, message];
  }
  const queued = new Set(queuedIds);
  const queueIndex = items.findIndex((item) => queued.has(item.id));
  if (existing >= 0 && (queueIndex < 0 || existing < queueIndex)) return items;
  const without = existing >= 0 ? items.filter((item) => item.id !== message.id) : items;
  const insertAt = without.findIndex((item) => queued.has(item.id));
  if (insertAt < 0) return existing >= 0 ? items : [...items, message];
  return [...without.slice(0, insertAt), message, ...without.slice(insertAt)];
}
