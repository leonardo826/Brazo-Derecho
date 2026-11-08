"use server";

import { redirect } from "next/navigation";
import { missingVaultTable } from "@/lib/credentials/http";
import { parseVaultPortalParam } from "@/lib/credentials/portal-form";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { confirmRisk, createCredential, deleteCredential } from "@/lib/credentials/service";
import { assertOwnOrganizationActive, guardMutation, guardRate, withError, withNotice } from "@/lib/guard";
import { requireSession } from "@/lib/session";

const BACK = "/panel/boveda";

function vaultBack(formData: FormData) {
  const preset = parseVaultPortalParam(formData.get("portalPreset"));
  return preset ? `/panel/boveda?portal=${preset}` : BACK;
}

export async function createCredentialAction(formData: FormData) {
  const back = vaultBack(formData);
  await guardMutation(formData, back);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, back);
  guardRate(`boveda:${session.organizationId}`, 10, 60_000, back);
  try {
    const result = await createCredential(
      prismaCredentialRepo(),
      {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        label: String(formData.get("label") ?? ""),
        portal: String(formData.get("portal") ?? ""),
        username: String(formData.get("username") ?? ""),
        secret: String(formData.get("secret") ?? ""),
        consentAcceptedAt: formData.get("consent") === "on",
      },
      process.env,
    );
    if (!result.ok) redirect(withError(back, result.error));
  } catch (error) {
    if (missingVaultTable(error)) redirect(withError(back, "boveda_migracion"));
    throw error;
  }
  redirect(withNotice(BACK, "ok", "boveda_guardada"));
}

export async function deleteCredentialAction(formData: FormData) {
  await guardMutation(formData, BACK);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`boveda-baja:${session.organizationId}`, 20, 60_000, BACK);
  try {
    const result = await deleteCredential(prismaCredentialRepo(), {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      credentialId: String(formData.get("id") ?? ""),
    });
    if (!result.ok) redirect(withError(BACK, result.error));
  } catch (error) {
    if (missingVaultTable(error)) redirect(withError(BACK, "boveda_migracion"));
    throw error;
  }
  redirect(withNotice(BACK, "ok", "boveda_eliminada"));
}

export async function confirmRiskAction(formData: FormData) {
  await guardMutation(formData, BACK);
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, BACK);
  guardRate(`boveda-confirmacion:${session.organizationId}`, 10, 60_000, BACK);
  if (formData.get("confirmed") !== "on") redirect(withError(BACK, "boveda_confirmacion"));
  const action = formData.get("action");
  try {
    const result = await confirmRisk(prismaCredentialRepo(), {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action,
    });
    if (!result.ok) redirect(withError(BACK, result.error));
  } catch (error) {
    if (missingVaultTable(error)) redirect(withError(BACK, "boveda_migracion"));
    throw error;
  }
  redirect(withNotice(BACK, "ok", "boveda_confirmada"));
}
