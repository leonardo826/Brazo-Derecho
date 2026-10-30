"use server";

import { redirect } from "next/navigation";
import { guardMutation } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { formatRut, isValidRut } from "@/lib/rut";
import { requireSession, writeSession } from "@/lib/session";
import { organizationSchema } from "@/lib/validation";

export async function saveOnboardingCompanyAction(formData: FormData) {
  await guardMutation(formData, "/panel/empezar");
  const session = await requireSession();
  const parsed = organizationSchema.safeParse({
    organizationName: formData.get("organizationName"),
    rut: formData.get("rut") ?? "",
  });
  if (!parsed.success) redirect("/panel/empezar?error=datos");
  const rutRaw = parsed.data.rut.trim();
  if (rutRaw && !isValidRut(rutRaw)) redirect("/panel/empezar?error=rut");

  const organization = await prisma.organization.update({
    where: { id: session.organizationId },
    data: {
      name: parsed.data.organizationName.trim(),
      rut: rutRaw ? formatRut(rutRaw) : null,
    },
  });
  await writeSession({ ...session, organizationName: organization.name });
  redirect("/panel/empezar?paso=agente&ok=empresa_lista");
}
