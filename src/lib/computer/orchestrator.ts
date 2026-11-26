import { randomBytes } from "node:crypto";
import { isBulkGoal, isSensitiveGoal } from "../../../agent-runtime/src/sensitive";
import { machineAgentKind, type MachineAgentKind } from "@/lib/computer/agent-kind";
import { usableLease, type ComputerLease } from "@/lib/chat/desktop-task";
import { signRequest } from "@/lib/computer/request-sign";
import { callMachine } from "@/lib/computer/transport";

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

const NO_LEASE = "No hay un computador enrolado para esta empresa. No llamé con un token global.";

export async function enqueueComputerTask(
  input: {
    clientId: string;
    goal: string;
    agentKind?: MachineAgentKind;
    lease?: ComputerLease | null;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    agentPayload?: {
      credentials: { id: string; label: string; portal: string; usernameHint: string }[];
      fillGrant: string;
    };
  },
  deps: { store: ComputerStore },
): Promise<{ ok: true; task: ComputerTaskRecord; calledAgent: boolean } | { ok: false; error: "datos" }> {
  const goal = input.goal.trim();
  if (!goal || goal.length > 2000) return { ok: false, error: "datos" };
  if (!isBulkGoal(goal) && !isSensitiveGoal(goal) && !machineAgentKind(input.agentKind ?? "")) return { ok: false, error: "datos" };

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
      result: "Pendiente de aprobación. No se envió, no se declaró ni se pagó nada.",
    });
    return { ok: true, task, calledAgent: false };
  }

  const lease = input.lease ? usableLease(input.lease, input.clientId) : null;
  const task = await deps.store.insert({
    computerId: computer.id,
    clientId: input.clientId,
    goal,
    status: "QUEUED",
    sensitive: false,
    result: "",
  });
  if (!lease || !input.agentKind) {
    return { ok: true, task: await deps.store.finish(task.id, "FAILED", NO_LEASE), calledAgent: false };
  }

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const body: Record<string, unknown> = {
      goal,
      machineId: lease.machineId,
      taskId: `t_${randomBytes(9).toString("hex")}`,
      epoch: lease.epoch,
      agentKind: input.agentKind,
    };
    const payload = input.agentPayload;
    if (payload?.credentials.length) {
      body.credentials = payload.credentials.map((row) => ({
        id: row.id,
        label: row.label,
        portal: row.portal,
        usernameHint: row.usernameHint,
      }));
    }
    if (payload?.fillGrant) body.fillGrant = payload.fillGrant;
    const raw = JSON.stringify(body);
    Object.assign(headers, signRequest({ token: lease.token, method: "POST", path: "/task", body: raw, host: new URL(lease.baseUrl).hostname }));
    const response = await callMachine({
      origin: lease.baseUrl,
      pin: lease.pin,
      path: "/task",
      method: "POST",
      headers,
      body: raw,
      fetchImpl: input.fetchImpl,
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: true, task: await deps.store.finish(task.id, "FAILED", "El computador no completó la tarea."), calledAgent: true };
    }
    const data = (JSON.parse(response.body || "null") as { status?: unknown; result?: unknown } | null);
    const status = asStatus(data?.status) ?? (response.status >= 200 && response.status < 300 ? "DONE" : "FAILED");
    let result = typeof data?.result === "string" ? data.result.slice(0, 2000) : response.status >= 200 && response.status < 300 ? "" : "El computador no completó la tarea.";
    if (payload?.fillGrant) result = result.split(payload.fillGrant).join("[redactado]");
    result = result.split(lease.token).join("[redactado]");
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
