import type { AuthTokenKind } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/password";
import { createAuthTokenValue, hashAuthToken, RESET_TTL_MS, VERIFY_TTL_MS } from "@/lib/auth-token";
import { sendEmail } from "@/lib/email/send";
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { logEvent } from "@/lib/log";
import { prisma } from "@/lib/prisma";

type MailUser = { id: string; email: string; name: string };

async function issueToken(userId: string, kind: AuthTokenKind, ttlMs: number) {
  const raw = createAuthTokenValue();
  const now = new Date();
  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: { userId, kind, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.authToken.create({
      data: {
        userId,
        kind,
        tokenHash: hashAuthToken(raw),
        expiresAt: new Date(now.getTime() + ttlMs),
      },
    }),
  ]);
  return raw;
}

export async function issueEmailVerification(user: MailUser) {
  try {
    const raw = await issueToken(user.id, "EMAIL_VERIFY", VERIFY_TTL_MS);
    const url = `${appUrl()}/verificar?token=${encodeURIComponent(raw)}`;
    const message = verificationEmail({ name: user.name, url });
    await sendEmail({ ...message, to: user.email, kind: "verificacion" });
  } catch (error) {
    logEvent("email.error", {
      kind: "verificacion",
      to: user.email,
      message: (error instanceof Error ? error.message : "error").slice(0, 200),
    });
  }
}

export async function issuePasswordReset(user: MailUser) {
  const raw = await issueToken(user.id, "PASSWORD_RESET", RESET_TTL_MS);
  const url = `${appUrl()}/recuperar/nueva?token=${encodeURIComponent(raw)}`;
  const message = passwordResetEmail({ name: user.name, url });
  await sendEmail({ ...message, to: user.email, kind: "recuperacion" });
}

export async function consumePasswordReset(rawToken: string, password: string) {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const token = await tx.authToken.findUnique({ where: { tokenHash } });
    if (!token || token.kind !== "PASSWORD_RESET" || token.usedAt || token.expiresAt.getTime() <= now.getTime()) {
      return false;
    }
    const claimed = await tx.authToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    await tx.authToken.updateMany({
      where: { userId: token.userId, kind: "PASSWORD_RESET", usedAt: null },
      data: { usedAt: now },
    });
    return true;
  });
}

export async function consumeEmailVerification(rawToken: string) {
  const tokenHash = hashAuthToken(rawToken);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const token = await tx.authToken.findUnique({ where: { tokenHash } });
    if (!token || token.kind !== "EMAIL_VERIFY" || token.usedAt || token.expiresAt.getTime() <= now.getTime()) {
      return "invalid" as const;
    }
    const user = await tx.user.findUnique({
      where: { id: token.userId },
      select: { emailVerifiedAt: true },
    });
    if (!user) return "invalid" as const;
    const claimed = await tx.authToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return "invalid" as const;
    if (!user.emailVerifiedAt) {
      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
      });
    }
    return "ok" as const;
  });
}
