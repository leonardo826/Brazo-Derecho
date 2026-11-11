export const MODEL_HISTORY_LIMIT = 24;
export const THREAD_VIEW_LIMIT = 200;

export function historyWhere(threadId: string, organizationId: string, agent: "ACCOUNTING" | "MARKETING" | "WHATSAPP" = "ACCOUNTING") {
  return {
    threadId,
    thread: { organizationId, agent },
  };
}

export const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

export type TimedId = { id: string; createdAt: Date };

export function newestFirst<T extends TimedId>(rows: readonly T[]) {
  return [...rows].sort((a, b) => {
    const delta = b.createdAt.getTime() - a.createdAt.getTime();
    if (delta !== 0) return delta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Las filas ya vienen de la consulta más nueva primero. */
export function chronological<T>(newestFirstRows: readonly T[]) {
  return [...newestFirstRows].reverse();
}

/**
 * Página que usa el modelo y el panel: las últimas `limit`, en orden de conversación.
 * `orderBy asc` + `take` deja las primeras y esconde el pedido vigente.
 */
export function latestWindow<T extends TimedId>(rows: readonly T[], limit: number) {
  return chronological(newestFirst(rows).slice(0, limit));
}
