"use server";

import { redirect } from "next/navigation";
import { assertOwnOrganizationActive, guardMutation, withNotice } from "@/lib/guard";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { eraseAgentMemory, eraseMemoryFact } from "@/lib/memory/service";
import type { AgentKind } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { recordIdSchema } from "@/lib/validation";

const BACK: Record<AgentKind, string> = {
  WHATSAPP: "/panel/whatsapp",
  QUOTES: "/panel/cotizador",
  MARKETING: "/panel/marketing",
  ACCOUNTING: "/panel/contador",
};

function parseAgent(value: FormDataEntryValue | null): AgentKind | null {
  const text = String(value ?? "");
  if (text === "WHATSAPP" || text === "QUOTES" || text === "MARKETING" || text === "ACCOUNTING") return text;
  return null;
}

function backPath(agent: AgentKind | null) {
  return agent ? BACK[agent] : "/panel";
}

export async function forgetMemoryAction(formData: FormData) {
  const agent = parseAgent(formData.get("agente"));
  const back = backPath(agent);
  await guardMutation(formData, back);
  if (!agent || !memoryFeatureEnabled()) redirect(withNotice(back, "error", "datos"));
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  const parsedId = recordIdSchema.safeParse(formData.get("id"));
  if (!parsedId.success) redirect(withNotice(back, "error", "datos"));
  const deleted = await eraseMemoryFact(session.organizationId, parsedId.data);
  redirect(withNotice(back, deleted.count === 1 ? "ok" : "error", deleted.count === 1 ? "memoria" : "noencontrado"));
}

export async function forgetAllMemoryAction(formData: FormData) {
  const agent = parseAgent(formData.get("agente"));
  const back = backPath(agent);
  await guardMutation(formData, back);
  if (!agent || !memoryFeatureEnabled()) redirect(withNotice(back, "error", "datos"));
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  await eraseAgentMemory(session.organizationId, agent);
  redirect(withNotice(back, "ok", "memoria_todo"));
}
