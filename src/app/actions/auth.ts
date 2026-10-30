"use server";

import { Prisma } from "@/generated/prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumeEmailVerification, consumePasswordReset, issueEmailVerification, issuePasswordReset } from "@/lib/account-mail";
import { clientAddress, guardMutation, guardRate, withNotice } from "@/lib/guard";
import { logEvent } from "@/lib/log";
import { hashPassword, passwordError, verifyPassword } from "@/lib/password";
import { panelReturnPath, safePanelPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { isValidRut, formatRut } from "@/lib/rut";
import { clearSession, resolveSession, writeSession } from "@/lib/session";
import { slugify } from "@/lib/slug";
import { confirmEmailSchema, emailOnlySchema, loginSchema, registerSchema, resetPasswordSchema } from "@/lib/validation";

export async function registerAction(formData: FormData) {
  await guardMutation(formData, "/registro");
  await guardRate(`auth:register:${await clientAddress()}`, 5, 60 * 60 * 1000, "/registro");
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
      authVersion: user.authVersion,
    });
    await issueEmailVerification({ id: user.id, email: user.email, name: user.name });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      redirect(target.includes("email") ? "/registro?error=correo" : "/registro?error=datos");
    }
    throw error;
  }

  redirect("/panel/empezar");
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function loginAction(formData: FormData) {
  await guardMutation(formData, "/ingresar");
  const ip = await clientAddress();
  await guardRate(`auth:login:${ip}`, 20, LOGIN_WINDOW_MS, "/ingresar");
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/ingresar?error=credenciales");
  await guardRate(`auth:login:${ip}:${parsed.data.email.toLowerCase()}`, 8, LOGIN_WINDOW_MS, "/ingresar");

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
    authVersion: user.authVersion,
  });
  redirect(safePanelPath(String(formData.get("siguiente") ?? "")));
}

const HOUR_MS = 60 * 60 * 1000;

export async function requestPasswordResetAction(formData: FormData) {
  await guardMutation(formData, "/recuperar");
  const ip = await clientAddress();
  await guardRate(`auth:reset:${ip}`, 5, HOUR_MS, "/recuperar");
  const parsed = emailOnlySchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/recuperar?error=datos");
  const email = parsed.data.email.toLowerCase();
  await guardRate(`auth:reset:${ip}:${email}`, 3, HOUR_MS, "/recuperar");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (user) {
    try {
      await issuePasswordReset(user);
    } catch (error) {
      logEvent("email.error", {
        kind: "recuperacion",
        to: email,
        message: (error instanceof Error ? error.message : "error").slice(0, 200),
      });
    }
  }
  redirect("/recuperar?ok=clave_enviada");
}

export async function resetPasswordAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = `/recuperar/nueva?token=${encodeURIComponent(token)}`;
  await guardMutation(formData, "/recuperar/nueva");
  await guardRate(`auth:reset-use:${await clientAddress()}`, 10, HOUR_MS, back);
  const parsed = resetPasswordSchema.safeParse({ token, password: formData.get("password") });
  if (!parsed.success) redirect(`${back}&error=datos`);
  if (passwordError(parsed.data.password)) redirect(`${back}&error=clave`);
  const changed = await consumePasswordReset(parsed.data.token, parsed.data.password);
  if (!changed) redirect("/recuperar/nueva?error=token");
  redirect("/ingresar?ok=clave");
}

export async function confirmEmailAction(formData: FormData) {
  await guardMutation(formData, "/verificar");
  await guardRate(`auth:verify-use:${await clientAddress()}`, 10, HOUR_MS, "/verificar");
  const parsed = confirmEmailSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) redirect("/verificar?error=token");
  const result = await consumeEmailVerification(parsed.data.token);
  if (result !== "ok") redirect("/verificar?error=token");
  redirect("/verificar?ok=correo_ok");
}

export async function resendVerificationAction(formData: FormData) {
  const headerStore = await headers();
  const back = panelReturnPath(headerStore.get("referer"));
  await guardMutation(formData, back);
  const session = await resolveSession();
  if (!session) redirect("/ingresar?error=sesion");
  await guardRate(`auth:verify:${session.userId}`, 3, HOUR_MS, back);
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) redirect("/ingresar?error=sesion");
  if (user.emailVerifiedAt) redirect(withNotice(back, "ok", "verificado"));
  await issueEmailVerification(user);
  redirect(withNotice(back, "ok", "verificacion"));
}

export async function logoutAction(formData: FormData) {
  await guardMutation(formData, "/ingresar");
  const session = await resolveSession();
  if (!session) redirect("/");
  await clearSession();
  redirect("/");
}
