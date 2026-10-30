"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { hashPassword, passwordError, verifyPassword } from "@/lib/password";
import { safePanelPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { isValidRut, formatRut } from "@/lib/rut";
import { clearSession, resolveSession, writeSession } from "@/lib/session";
import { slugify } from "@/lib/slug";
import { loginSchema, registerSchema } from "@/lib/validation";

export async function registerAction(formData: FormData) {
  if (formData.get("consent") !== "on") redirect("/registro?error=consentimiento");
  const marketingOptIn = formData.get("marketingOptIn") === "on";
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organizationName: formData.get("organizationName"),
    rut: formData.get("rut") ?? "",
  });
  if (!parsed.success) redirect("/registro?error=datos");
  if (passwordError(parsed.data.password)) redirect("/registro?error=clave");
  const rutRaw = parsed.data.rut.trim();
  if (rutRaw && !isValidRut(rutRaw)) redirect("/registro?error=rut");

  const email = parsed.data.email.toLowerCase();
  let slug = slugify(parsed.data.organizationName);
  const slugTaken = await prisma.organization.findUnique({ where: { slug } });
  if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  try {
    const user = await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash: await hashPassword(parsed.data.password),
        consentAt: new Date(),
        marketingOptInAt: marketingOptIn ? new Date() : null,
        memberships: {
          create: {
            role: "OWNER",
            organization: {
              create: {
                name: parsed.data.organizationName.trim(),
                slug,
                rut: rutRaw ? formatRut(rutRaw) : null,
              },
            },
          },
        },
      },
      include: { memberships: { include: { organization: true } } },
    });
    const membership = user.memberships[0];
    await writeSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      role: membership.role,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      redirect(target.includes("email") ? "/registro?error=correo" : "/registro?error=datos");
    }
    throw error;
  }

  redirect("/panel?ok=cuenta");
}

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/ingresar?error=credenciales");

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: {
      memberships: {
        include: { organization: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) redirect("/ingresar?error=credenciales");
  const matches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!matches) redirect("/ingresar?error=credenciales");

  await writeSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
  });
  redirect(safePanelPath(String(formData.get("siguiente") ?? "")));
}

export async function logoutAction() {
  const session = await resolveSession();
  if (!session) redirect("/");
  await clearSession();
  redirect("/");
}
