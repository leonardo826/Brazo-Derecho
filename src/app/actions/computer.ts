"use server";

import { redirect } from "next/navigation";
import { decideSensitiveTask, enqueueComputerTask } from "@/lib/computer/orchestrator";
import { issueNovncToken } from "@/lib/computer/novnc";
import { prismaComputerStore } from "@/lib/computer/store";
import { assertOwnOrganizationActive, guardMutation, guardRate, withError, withNotice } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

const BACK = "/panel/computador";

export async function enqueueComputerAction(formData: FormData) {
  await guardMutation(formData, BACK);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`computer:${session.organizationId}`, 20, 60_000, BACK);
  const result = await enqueueComputerTask(
    {
      clientId: session.organizationId,
      goal: String(formData.get("goal") ?? ""),
      agentUrl: process.env.COMPUTER_AGENT_URL,
      agentToken: process.env.COMPUTER_AGENT_TOKEN,
    },
    { store: prismaComputerStore() },
  );
  if (!result.ok) redirect(withError(BACK, result.error));
  const code =
    result.task.status === "PENDING_APPROVAL"
      ? "computador_pendiente"
      : result.task.status === "REJECTED"
        ? "computador_rechazada"
        : "computador_tarea";
  redirect(withNotice(BACK, "ok", code));
}

export async function mintComputerViewAction(formData: FormData) {
  await guardMutation(formData, BACK);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`novnc:${session.organizationId}`, 10, 60_000, BACK);
  const issued = issueNovncToken();
  await prisma.computer.upsert({
    where: { clientId: session.organizationId },
    update: { novncTokenHash: issued.hash, novncExpiresAt: issued.expiresAt },
    create: { clientId: session.organizationId, novncTokenHash: issued.hash, novncExpiresAt: issued.expiresAt },
  });
  redirect(`${BACK}?token=${encodeURIComponent(issued.token)}`);
}

export async function decideComputerAction(formData: FormData) {
  await guardMutation(formData, BACK);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`computer-decision:${session.organizationId}`, 30, 60_000, BACK);
  const decision = formData.get("decision") === "APPROVED" ? "APPROVED" : formData.get("decision") === "REJECTED" ? "REJECTED" : null;
  const taskId = String(formData.get("id") ?? "");
  if (!decision || !taskId) redirect(withError(BACK, "datos"));
  const result = await decideSensitiveTask(prismaComputerStore(), {
    clientId: session.organizationId,
    taskId,
    decision,
  });
  if (!result.ok) redirect(withError(BACK, result.error));
  redirect(withNotice(BACK, "ok", decision === "APPROVED" ? "computador_aprobada" : "computador_descartada"));
}
