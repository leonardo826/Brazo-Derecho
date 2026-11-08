import { limitFor, type AgentId, type MetricId } from "@/lib/catalog";
import { PLAN_LIMIT_MESSAGE } from "@/lib/plan-copy";
import { releaseDailyTask, reserveDailyTask, type TaskSlot } from "@/lib/meter-store";
import { evaluateLimit } from "@/lib/usage";
import { usedThisMonth } from "@/lib/usage-store";

export type PlanCheck = {
  agent: AgentId;
  metric: MetricId;
  quantity: number;
};

type UsedLoader = (organizationId: string, metric: MetricId, now?: Date) => Promise<number>;
type ReserveTask = (organizationId: string, now?: Date) => Promise<TaskSlot>;
type ReleaseTask = (reservationId: string | null | undefined) => Promise<void>;

export async function planRoom(input: {
  organizationId: string;
  checks: PlanCheck[];
  now?: Date;
  loadUsed?: UsedLoader;
}) {
  if (input.checks.length === 0) {
    throw new Error("Hay que indicar el cupo del plan antes de llamar a xAI");
  }
  const loadUsed = input.loadUsed ?? usedThisMonth;
  for (const check of input.checks) {
    const used = await loadUsed(input.organizationId, check.metric, input.now);
    const decision = evaluateLimit(used, check.quantity, limitFor(check.agent, check.metric));
    if (!decision.ok) {
      return { ok: false as const, reason: "limite" as const, message: PLAN_LIMIT_MESSAGE, metric: check.metric };
    }
  }
  return { ok: true as const };
}

export async function callWithinPlan<T>(input: {
  organizationId: string;
  checks: PlanCheck[];
  now?: Date;
  loadUsed?: UsedLoader;
  reserveTask?: ReserveTask;
  releaseTask?: ReleaseTask;
  call: () => Promise<T>;
}): Promise<
  { ok: true; value: T; reservationId: string | null } | { ok: false; reason: "limite"; message: string }
> {
  const room = await planRoom(input);
  if (!room.ok) return { ok: false, reason: "limite", message: room.message };
  const reserve = input.reserveTask ?? reserveDailyTask;
  const release = input.releaseTask ?? releaseDailyTask;
  const slot = await reserve(input.organizationId, input.now);
  if (!slot.ok) return { ok: false, reason: "limite", message: PLAN_LIMIT_MESSAGE };
  try {
    const value = await input.call();
    return { ok: true, value, reservationId: slot.reservationId };
  } catch (error) {
    await release(slot.reservationId);
    throw error;
  }
}
