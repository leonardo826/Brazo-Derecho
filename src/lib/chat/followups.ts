export type TurnQueue<T> = {
  active: T | null;
  waiting: T[];
};

export type TurnEnd = "done" | "abort" | "error";

export function pushTurn<T>(queue: TurnQueue<T>, draft: T): { queue: TurnQueue<T>; startNow: boolean } {
  if (queue.active) {
    return { queue: { active: queue.active, waiting: [...queue.waiting, draft] }, startNow: false };
  }
  return { queue: { active: draft, waiting: queue.waiting }, startNow: true };
}

/** A stopped or finished turn starts the next draft. An error leaves the queue paused. */
export function completeTurn<T>(queue: TurnQueue<T>, end: TurnEnd): { queue: TurnQueue<T>; next: T | null } {
  if (end === "error") {
    return { queue: { active: null, waiting: queue.waiting }, next: null };
  }
  const [next, ...waiting] = queue.waiting;
  if (!next) return { queue: { active: null, waiting: [] }, next: null };
  return { queue: { active: next, waiting }, next };
}

export function releasePaused<T>(queue: TurnQueue<T>): { queue: TurnQueue<T>; next: T | null } {
  if (queue.active) return { queue, next: null };
  return completeTurn({ active: null, waiting: queue.waiting }, "done");
}

export function requeueFront<T extends { id: string }>(queue: TurnQueue<T>, draft: T): TurnQueue<T> {
  const waiting = queue.waiting.filter((item) => item.id !== draft.id);
  return { active: queue.active, waiting: [draft, ...waiting] };
}
