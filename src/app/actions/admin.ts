"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/admin";
import { assertOwnOrganizationActive, guardMutation } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { phoneIdSchema, recordIdSchema, suspensionSchema } from "@/lib/validation";

export async function linkWhatsappNumberAction(formData: FormData) {
  const session = await requireSession();
  const requestedOrg = String(formData.get("organizationId") ?? "");
  const platform = isPlatformAdmin(session.email);
  const organizationId = platform && requestedOrg ? requestedOrg : session.organizationId;
  const back = platform && requestedOrg ? "/panel/admin" : "/panel/whatsapp";
  await guardMutation(formData, back);
  if (!platform && session.role !== "OWNER") redirect(`${back}?error=admin`);
  if (!platform) await assertOwnOrganizationActive(session.organizationId, back);
  if (platform && requestedOrg) {
    if (!recordIdSchema.safeParse(organizationId).success) redirect("/panel/admin?error=datos");
    const exists = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!exists) redirect("/panel/admin?error=noencontrado");
  }

  const parsedPhone = phoneIdSchema.safeParse(String(formData.get("whatsappPhoneNumberId") ?? ""));
  if (!parsedPhone.success) redirect(`${back}?error=numero`);
  const phoneId = parsedPhone.data;

  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { whatsappPhoneNumberId: phoneId || null },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(`${back}?error=numero_tomado`);
    }
    throw error;
  }
  redirect(`${back}?ok=${phoneId ? "numero" : "numero_off"}`);
}

export async function setOrganizationSuspensionAction(formData: FormData) {
  await guardMutation(formData, "/panel/admin");
  const session = await requireSession();
  if (!isPlatformAdmin(session.email)) redirect("/panel?error=plataforma");
  const parsed = suspensionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    suspended: formData.get("suspended"),
  });
  if (!parsed.success) redirect("/panel/admin?error=datos");
  const updated = await prisma.organization.updateMany({
    where: { id: parsed.data.organizationId },
    data: { suspendedAt: parsed.data.suspended === "1" ? new Date() : null },
  });
  if (updated.count !== 1) redirect("/panel/admin?error=noencontrado");
  redirect(`/panel/admin?ok=${parsed.data.suspended === "1" ? "suspendida" : "reactivada"}`);
}
