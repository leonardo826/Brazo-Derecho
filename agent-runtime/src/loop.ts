import { describeAction } from "./actions.ts";
import type { ComputerModel, Desktop } from "./desktop.ts";
import { isBulkGoal, isSensitiveGoal } from "./sensitive.ts";

export type TaskStep =
  | { kind: "screenshot"; bytes: number }
  | { kind: "action"; action: { type: string; url?: string } };

export type TaskResult = {
  status: "DONE" | "FAILED" | "PENDING_APPROVAL" | "REJECTED";
  result: string;
  steps: TaskStep[];
};

export async function runComputerTask(input: {
  goal: string;
  desktop: Desktop;
  model: ComputerModel;
  maxSteps?: number;
}): Promise<TaskResult> {
  const goal = input.goal.trim();
  if (isBulkGoal(goal)) {
    return { status: "REJECTED", result: "No hago envíos masivos ni difusión.", steps: [] };
  }
  if (isSensitiveGoal(goal)) {
    return {
      status: "PENDING_APPROVAL",
      result: "Esta acción queda pendiente de aprobación. No envié mensajes ni pagué nada.",
      steps: [],
    };
  }

  const steps: TaskResult["steps"] = [];
  const history: string[] = [];
  const maxSteps = input.maxSteps ?? 8;
  for (let step = 0; step < maxSteps; step += 1) {
    let screenshot: Buffer;
    try {
      screenshot = await input.desktop.screenshot();
    } catch {
      return { status: "FAILED", result: "No pude tomar la captura del escritorio.", steps };
    }
    steps.push({ kind: "screenshot", bytes: screenshot.length });
    let decision;
    try {
      decision = await input.model.decide({ goal, screenshot, step, history });
    } catch {
      return { status: "FAILED", result: "El modelo no respondió. No se hizo ninguna acción sensible.", steps };
    }
    if (decision.kind === "done") {
      return { status: "DONE", result: decision.result, steps };
    }
    try {
      await input.desktop.perform(decision.action);
    } catch {
      return { status: "FAILED", result: "No pude ejecutar la acción en el escritorio.", steps };
    }
    history.push(describeAction(decision.action));
    steps.push({
      kind: "action",
      action: decision.action.type === "goto" ? { type: "goto", url: decision.action.url } : { type: decision.action.type },
    });
  }
  return { status: "FAILED", result: "Se acabaron los pasos del computador.", steps };
}
