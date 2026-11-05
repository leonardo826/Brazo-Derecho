import { isBulkGoal, isSensitiveGoal } from "../../../agent-runtime/src/sensitive";

export type TaskStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export type ComputerTaskRecord = {
  id: string;
  computerId: string;
  clientId: string;
  goal: string;
  status: TaskStatus;
  sensitive: boolean;
  result: string;
};

export type ComputerStore = {
  ensure(clientId: string): Promise<{ id: string }>;
  insert(task: Omit<ComputerTaskRecord, "id">): Promise<ComputerTaskRecord>;
  finish(id: string, status: TaskStatus, result: string): Promise<ComputerTaskRecord>;
  get(id: string): Promise<ComputerTaskRecord | null>;
};

const AGENT_STATUSES = new Set<TaskStatus>(["DONE", "FAILED", "PENDING_APPROVAL", "REJECTED", "QUEUED", "APPROVED"]);

function asStatus(value: unknown): TaskStatus | null {
  return typeof value === "string" && AGENT_STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : null;
}

export async function enqueueComputerTask(
  input: {
    clientId: string;
    goal: string;
    agentUrl?: string;
    agentToken?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
  deps: { store: ComputerStore },
): Promise<{ ok: true; task: ComputerTaskRecord; calledAgent: boolean } | { ok: false; error: "datos" }> {
  const goal = input.goal.trim();
  if (!goal || goal.length > 2000) return { ok: false, error: "datos" };
  const computer = await deps.store.ensure(input.clientId);
  if (isBulkGoal(goal)) {
    const task = await deps.store.insert({
      computerId: computer.id,
      clientId: input.clientId,
      goal,
      status: "REJECTED",
      sensitive: true,
      result: "No hago envíos masivos ni difusión.",
    });
    return { ok: true, task, calledAgent: false };
  }
  if (isSensitiveGoal(goal)) {
    const task = await deps.store.insert({
      computerId: computer.id,
      clientId: input.clientId,
      goal,
      status: "PENDING_APPROVAL",
      sensitive: true,
      result: "Pendiente de aprobación. No se envió ni se pagó nada.",
    });
    return { ok: true, task, calledAgent: false };
  }

  const agentUrl = input.agentUrl?.trim() ?? "";
  const task = await deps.store.insert({
    computerId: computer.id,
    clientId: input.clientId,
    goal,
    status: "QUEUED",
    sensitive: false,
    result: agentUrl ? "" : "En cola. Falta COMPUTER_AGENT_URL: no llamé a ningún computador.",
  });
  if (!agentUrl) return { ok: true, task, calledAgent: false };

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.agentToken?.trim()) headers.authorization = `Bearer ${input.agentToken.trim()}`;
    const response = await (input.fetchImpl ?? fetch)(`${agentUrl.replace(/\/$/, "")}/task`, {
      method: "POST",
      headers,
      body: JSON.stringify({ goal }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    });
    const data = (await response.json().catch(() => null)) as { status?: unknown; result?: unknown } | null;
    const status = asStatus(data?.status) ?? (response.ok ? "DONE" : "FAILED");
    const result = typeof data?.result === "string" ? data.result.slice(0, 2000) : response.ok ? "" : "El computador no completó la tarea.";
    return { ok: true, task: await deps.store.finish(task.id, status, result), calledAgent: true };
  } catch {
    return { ok: true, task: await deps.store.finish(task.id, "FAILED", "No pude hablar con el computador."), calledAgent: true };
  }
}

export async function decideSensitiveTask(
  store: ComputerStore,
  input: { clientId: string; taskId: string; decision: "APPROVED" | "REJECTED" },
) {
  const task = await store.get(input.taskId);
  if (!task || task.clientId !== input.clientId) return { ok: false as const, error: "noencontrado" as const };
  if (!task.sensitive || task.status !== "PENDING_APPROVAL") return { ok: false as const, error: "datos" as const };
  if (input.decision === "REJECTED") {
    return { ok: true as const, task: await store.finish(task.id, "REJECTED", "Descartada. No se envió nada.") };
  }
  return {
    ok: true as const,
    task: await store.finish(
      task.id,
      "APPROVED",
      "Aprobada en el panel. El envío y el pago siguen apagados en esta fase: no salió ningún mensaje.",
    ),
  };
}
