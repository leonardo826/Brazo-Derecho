"use server";

import { redirect } from "next/navigation";
import { guardMutation } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { formatRut, isValidRut } from "@/lib/rut";
import { requireSession, writeSession } from "@/lib/session";
import { organizationSchema } from "@/lib/validation";

export async function updateOrganizationAction(formData: FormData) {
  await guardMutation(formData, "/panel/cuenta");
  const session = await requireSession();
  const parsed = organizationSchema.safeParse({
    organizationName: formData.get("organizationName"),
    rut: formData.get("rut") ?? "",
  });
  if (!parsed.success) redirect("/panel/cuenta?error=datos");
  const rutRaw = parsed.data.rut.trim();
  if (rutRaw && !isValidRut(rutRaw)) redirect("/panel/cuenta?error=rut");

  const organization = await prisma.organization.update({
    where: { id: session.organizationId },
    data: {
      name: parsed.data.organizationName.trim(),
      rut: rutRaw ? formatRut(rutRaw) : null,
    },
  });
  await writeSession({ ...session, organizationName: organization.name });
  redirect("/panel/cuenta?ok=empresa");
}
