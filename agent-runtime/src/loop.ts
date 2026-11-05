import { describeAction } from "./actions.ts";
import type { CredentialMeta } from "./credentials.ts";
import type { ComputerModel, Desktop } from "./desktop.ts";
import { redactText } from "./redact.ts";
import { isBulkGoal, isHighRiskGoal, isSendGoal } from "./sensitive.ts";

export type TaskStep =
  | { kind: "screenshot"; bytes: number }
  | { kind: "action"; action: { type: string; url?: string; credentialId?: string } };

export type TaskResult = {
  status: "DONE" | "FAILED" | "PENDING_APPROVAL" | "REJECTED";
  result: string;
  steps: TaskStep[];
};

export type FillMaterial = { username: string; secret: string };

function usable(value: string) {
  return value.length > 0 && value.length <= 400 && !/[\r\n\u0000]/.test(value);
}

export async function runComputerTask(input: {
  goal: string;
  desktop: Desktop;
  model: ComputerModel;
  maxSteps?: number;
  credentials?: CredentialMeta[];
  clientConfirmed?: boolean;
  fillLogin?: (credentialId: string) => Promise<FillMaterial | null>;
}): Promise<TaskResult> {
  const goal = input.goal.trim();
  if (isBulkGoal(goal)) {
    return { status: "REJECTED", result: "No hago envíos masivos ni difusión.", steps: [] };
  }
  if (isSendGoal(goal) || (isHighRiskGoal(goal) && input.clientConfirmed !== true)) {
    return {
      status: "PENDING_APPROVAL",
      result: "Esta acción queda pendiente de aprobación. No envié mensajes, no presenté declaraciones ni pagué nada.",
      steps: [],
    };
  }

  const steps: TaskResult["steps"] = [];
  const history: string[] = [];
  const knownSecrets: string[] = [];
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
      decision = await input.model.decide({
        goal: redactText(goal, knownSecrets),
        screenshot,
        step,
        history: history.map((line) => redactText(line, knownSecrets)),
        credentials: input.credentials,
        clientConfirmed: input.clientConfirmed === true,
      });
    } catch {
      return { status: "FAILED", result: "El modelo no respondió. No se hizo ninguna acción sensible.", steps };
    }
    if (decision.kind === "done") {
      return { status: "DONE", result: redactText(decision.result, knownSecrets).slice(0, 2000), steps };
    }
    if (decision.action.type === "fill") {
      let material: FillMaterial | null = null;
      try {
        material = input.fillLogin ? await input.fillLogin(decision.action.credentialId) : null;
      } catch {
        material = null;
      }
      if (!material || !usable(material.username) || !usable(material.secret)) {
        return { status: "FAILED", result: "No pude rellenar el acceso. La clave no se mostró.", steps };
      }
      try {
        await input.desktop.perform({ type: "type", text: material.username });
        await input.desktop.perform({ type: "key", key: "Tab" });
        await input.desktop.perform({ type: "type", text: material.secret });
      } catch {
        return { status: "FAILED", result: "No pude escribir el acceso en el escritorio.", steps };
      }
      if (material.username.length >= 4) knownSecrets.push(material.username);
      if (material.secret.length >= 4) knownSecrets.push(material.secret);
      history.push(`fill ${decision.action.credentialId}`);
      steps.push({ kind: "action", action: { type: "fill", credentialId: decision.action.credentialId } });
      continue;
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
