import { afterAll, describe, expect, test } from "vitest";
import { consumeEmailVerification, consumePasswordReset, issueEmailVerification, issuePasswordReset } from "@/lib/account-mail";
import { hashAuthToken } from "@/lib/auth-token";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const createdUsers: string[] = [];

async function makeUser(label: string) {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Ana Pérez",
      passwordHash: "pendiente",
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: label, slug: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}` } },
        },
      },
    },
  });
  createdUsers.push(user.id);
  return user;
}

afterAll(async () => {
  if (createdUsers.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: createdUsers } },
      select: { email: true, memberships: { select: { organizationId: true } } },
    });
    const emails = users.map((user) => user.email);
    const orgs = users.flatMap((user) => user.memberships.map((membership) => membership.organizationId));
    await prisma.emailMessage.deleteMany({ where: { to: { in: emails } } });
    if (orgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  }
  await prisma.$disconnect();
});

describe("confirmación y recuperación", () => {
  test("el enlace de correo se usa una vez y el simulador lo guarda", async () => {
    const user = await makeUser("verifica");
    await issueEmailVerification(user);
    const stored = await prisma.emailMessage.findFirst({
      where: { to: user.email, kind: "verificacion" },
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.provider).toBe("mock");
    expect(stored?.status).toBe("simulado");
    const url = stored?.text.match(/https?:\/\/\S+/)?.[0];
    expect(url).toBeTruthy();
    const token = new URL(url ?? "").searchParams.get("token") ?? "";
    expect(await consumeEmailVerification(token)).toBe("ok");
    expect(await consumeEmailVerification(token)).toBe("invalid");
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.emailVerifiedAt).toBeTruthy();
    const row = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: hashAuthToken(token) } });
    expect(row.usedAt).toBeTruthy();
  });

  test("pedir otro enlace invalida el anterior", async () => {
    const user = await makeUser("reenvio");
    await issueEmailVerification(user);
    const first = await prisma.emailMessage.findFirstOrThrow({
      where: { to: user.email, kind: "verificacion" },
      orderBy: { createdAt: "asc" },
    });
    const firstToken = new URL(first.text.match(/https?:\/\/\S+/)?.[0] ?? "http://localhost").searchParams.get("token") ?? "";
    await issueEmailVerification(user);
    expect(await consumeEmailVerification(firstToken)).toBe("invalid");
    const latest = await prisma.emailMessage.findFirstOrThrow({
      where: { to: user.email, kind: "verificacion" },
      orderBy: { createdAt: "desc" },
    });
    const token = new URL(latest.text.match(/https?:\/\/\S+/)?.[0] ?? "http://localhost").searchParams.get("token") ?? "";
    expect(await consumeEmailVerification(token)).toBe("ok");
  });

  test("la clave nueva se usa una vez y cierra la versión de la sesión", async () => {
    const user = await makeUser("clave");
    await issuePasswordReset(user);
    const stored = await prisma.emailMessage.findFirstOrThrow({
      where: { to: user.email, kind: "recuperacion" },
    });
    expect(stored.text).toContain("/recuperar/nueva?token=");
    const token = new URL(stored.text.match(/https?:\/\/\S+/)?.[0] ?? "http://localhost").searchParams.get("token") ?? "";
    expect(await consumePasswordReset(token, "Clave-nueva-2026")).toBe(true);
    expect(await consumePasswordReset(token, "Clave-otra-2026")).toBe(false);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.authVersion).toBe(1);
    expect(await verifyPassword("Clave-nueva-2026", updated.passwordHash)).toBe(true);
    expect(await verifyPassword("Clave-otra-2026", updated.passwordHash)).toBe(false);
  });

  test("un enlace vencido no cambia la clave", async () => {
    const user = await makeUser("vencido");
    const raw = "token-vencido-de-prueba-con-largo-suficiente";
    await prisma.authToken.create({
      data: {
        userId: user.id,
        kind: "PASSWORD_RESET",
        tokenHash: hashAuthToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(await consumePasswordReset(raw, "Clave-nueva-2026")).toBe(false);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.authVersion).toBe(0);
    expect(updated.passwordHash).toBe("pendiente");
  });
});
