import { timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const QA_ORG_SLUG = "qa-interno";
export const QA_USER_NAME = "QA Interno";
export const QA_ORG_NAME = "QA Interno Brazo Derecho";
export const QA_ACCESS_MS = 365 * 24 * 60 * 60 * 1000;

type OrgDb = PrismaClient | Prisma.TransactionClient;

export class QaSinCobroError extends Error {
  constructor() {
    super("La cuenta de prueba interna no genera cobros");
    this.name = "QaSinCobroError";
  }
}

function qaCredentials() {
  const email = process.env.QA_LOGIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.QA_LOGIN_PASSWORD ?? "";
  if (!email || password.length === 0) return null;
  return { email, password };
}

/** Compara la clave sin filtrar el valor por la duración de la comparación. */
export function passwordsMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) {
    const sample = a.length === 0 ? Buffer.alloc(1) : a;
    timingSafeEqual(sample, Buffer.alloc(sample.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * True solo si el correo y la clave del formulario coinciden con los secretos.
 * Si el correo no es el de QA, devuelve false y el login normal sigue igual.
 */
export function isQaLogin(email: string, password: string) {
  const credentials = qaCredentials();
  if (!credentials) return false;
  if (email.trim().toLowerCase() !== credentials.email) return false;
  return passwordsMatch(password, credentials.password);
}

/** La exclusión de cobros y métricas se decide por la empresa, no por el usuario. */
export function recordsBillingUsage(isQa: boolean) {
  return isQa !== true;
}

export async function organizationIsQa(organizationId: string, db: OrgDb = prisma) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { isQa: true },
  });
  return organization?.isQa === true;
}

export async function qaOrganizationIdSet(organizationIds: string[]) {
  const ids = new Set<string>();
  if (organizationIds.length === 0) return ids;
  const rows = await prisma.organization.findMany({
    where: { id: { in: organizationIds }, isQa: true },
    select: { id: true },
  });
  for (const row of rows) ids.add(row.id);
  return ids;
}

export async function assertBillableOrganization(organizationId: string) {
  if (await organizationIsQa(organizationId)) throw new QaSinCobroError();
}

export async function provisionQaAccount(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const periodEnd = new Date(now.getTime() + QA_ACCESS_MS);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        name: QA_USER_NAME,
        passwordHash,
        emailVerifiedAt: now,
        consentAt: now,
      },
      update: {
        name: QA_USER_NAME,
        passwordHash,
        emailVerifiedAt: now,
        consentAt: now,
      },
    });
    const organization = await tx.organization.upsert({
      where: { slug: QA_ORG_SLUG },
      create: {
        name: QA_ORG_NAME,
        slug: QA_ORG_SLUG,
        isQa: true,
        suspendedAt: null,
      },
      update: {
        name: QA_ORG_NAME,
        isQa: true,
        suspendedAt: null,
      },
    });
    await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
      create: { userId: user.id, organizationId: organization.id, role: "OWNER" },
      update: { role: "OWNER" },
    });
    const subscription = await tx.subscription.upsert({
      where: { organizationId_agent: { organizationId: organization.id, agent: "ACCOUNTING" } },
      create: {
        organizationId: organization.id,
        agent: "ACCOUNTING",
        status: "ACTIVE",
        periodStart: now,
        periodEnd,
      },
      update: {
        status: "ACTIVE",
        periodEnd,
      },
    });
    return { user, organization, subscription };
  });
}
