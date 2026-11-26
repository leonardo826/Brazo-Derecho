"use server";

import { redirect } from "next/navigation";
import { machineAgentKind } from "@/lib/computer/agent-kind";
import { computerEnabledForOrg, computerOrgGateClosed } from "@/lib/computer/flag";
import { decideSensitiveTask, enqueueComputerTask } from "@/lib/computer/orchestrator";
import { loadTenantLease } from "@/lib/computer/lease";
import { issueNovncToken } from "@/lib/computer/novnc";
import { usableLease } from "@/lib/chat/desktop-task";
import { prismaComputerStore } from "@/lib/computer/store";
import { missingVaultTable } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { prepareCredentialUse } from "@/lib/credentials/service";
import { assertOwnOrganizationActive, guardMutation, guardRate, withError, withNotice } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

const BACK = "/panel/computador";

async function openComputerSession(formData: FormData) {
  if (computerOrgGateClosed()) redirect("/panel");
  await guardMutation(formData, BACK);
  const session = await requireSession();
  if (!computerEnabledForOrg(session.organizationId)) redirect("/panel");
  return session;
}

export async function enqueueComputerAction(formData: FormData) {
  const session = await openComputerSession(formData);
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`computer:${session.organizationId}`, 20, 60_000, BACK);
  const goal = String(formData.get("goal") ?? "");
  const agentKind = machineAgentKind(String(formData.get("agentKind") ?? ""));
  if (!agentKind) redirect(withError(BACK, "datos"));
  const credentialId = String(formData.get("credentialId") ?? "").trim();
  let agentPayload: { credentials: { id: string; label: string; portal: string; usernameHint: string }[]; fillGrant: string } | undefined;
  try {
    const prepared = await prepareCredentialUse(
      prismaCredentialRepo(),
      {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        goal,
        credentialId: credentialId || undefined,
      },
      process.env,
    );
    if (!prepared.ok) redirect(withError(BACK, prepared.error));
    agentPayload = prepared.agentPayload;
  } catch (error) {
    if (!missingVaultTable(error)) throw error;
    if (credentialId) redirect(withError(BACK, "boveda_migracion"));
  }
  const looked = await loadTenantLease(session.organizationId);
  const lease = looked.state === "listo" ? usableLease(looked.lease, session.organizationId) : null;
  const result = await enqueueComputerTask(
    {
      clientId: session.organizationId,
      goal,
      agentKind,
      lease,
      agentPayload,
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
  const session = await openComputerSession(formData);
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
  const session = await openComputerSession(formData);
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
