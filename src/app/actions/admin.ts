"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { isPlatformAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

function cleanPhoneId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/^\d{8,20}$/.test(trimmed)) return null;
  return trimmed;
}

export async function linkWhatsappNumberAction(formData: FormData) {
  const session = await requireSession();
  const requestedOrg = String(formData.get("organizationId") ?? "");
  const platform = isPlatformAdmin(session.email);
  const organizationId = platform && requestedOrg ? requestedOrg : session.organizationId;
  const back = platform && requestedOrg ? "/panel/admin" : "/panel/whatsapp";
  if (!platform && session.role !== "OWNER") redirect(`${back}?error=admin`);
  if (platform && requestedOrg) {
    const exists = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!exists) redirect("/panel/admin?error=noencontrado");
  }

  const phoneId = cleanPhoneId(String(formData.get("whatsappPhoneNumberId") ?? ""));
  if (phoneId === null) redirect(`${back}?error=numero`);

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
