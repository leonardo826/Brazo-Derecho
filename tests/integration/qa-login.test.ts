import { afterAll, describe, expect, test, vi } from "vitest";
import { authenticate } from "@/lib/login";
import { companyMeter, recordMeter } from "@/lib/meter-store";
import { startMercadoPagoSubscription } from "@/lib/mercadopago/checkout";
import { activateMockPlan } from "@/lib/flow/mock-checkout";
import { startFlowSubscription } from "@/lib/flow/checkout";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { QA_ACCESS_MS, QA_ORG_NAME, QA_ORG_SLUG, QA_USER_NAME, QaSinCobroError } from "@/lib/qa-account";
import { reserveUsage, usageSnapshot } from "@/lib/usage-store";

const QA_EMAIL = "qa.interno@test.local";
const QA_PASSWORD = "Clave-qa-prueba-2026";
const NORMAL_PASSWORD = "Clave-normal-2026";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const previousEmail = process.env.QA_LOGIN_EMAIL;
const previousPassword = process.env.QA_LOGIN_PASSWORD;

function useQaEnv() {
  process.env.QA_LOGIN_EMAIL = QA_EMAIL;
  process.env.QA_LOGIN_PASSWORD = QA_PASSWORD;
}

async function makeOrg(label: string, isQa = false) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@test.local`,
      name: label,
      passwordHash: await hashPassword(NORMAL_PASSWORD),
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: label, slug: `${label}-${suffix}`, isQa } },
        },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  createdOrgs.push(user.memberships[0].organizationId);
  return { organizationId: user.memberships[0].organizationId, email: user.email };
}

async function removeQaAccount() {
  const organization = await prisma.organization.findUnique({ where: { slug: QA_ORG_SLUG }, select: { id: true } });
  if (organization) await prisma.organization.delete({ where: { id: organization.id } });
  await prisma.user.deleteMany({ where: { email: QA_EMAIL } });
}

afterAll(async () => {
  await removeQaAccount();
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  if (previousEmail === undefined) delete process.env.QA_LOGIN_EMAIL;
  else process.env.QA_LOGIN_EMAIL = previousEmail;
  if (previousPassword === undefined) delete process.env.QA_LOGIN_PASSWORD;
  else process.env.QA_LOGIN_PASSWORD = previousPassword;
  await prisma.$disconnect();
});

describe("cuenta QA", () => {
  test("el login normal no marca la empresa ni acepta la clave de prueba", async () => {
    useQaEnv();
    await removeQaAccount();
    const normal = await makeOrg("cliente-normal");
    const session = await authenticate(normal.email, NORMAL_PASSWORD);
    expect(session?.organizationId).toBe(normal.organizationId);
    expect(session?.email).toBe(normal.email);
    expect(JSON.stringify(session)).not.toContain(NORMAL_PASSWORD);
    expect(JSON.stringify(session)).not.toContain(QA_PASSWORD);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: normal.organizationId } });
    expect(organization.isQa).toBe(false);
    expect(await authenticate(normal.email, "clave-incorrecta")).toBeNull();
    expect(await authenticate(normal.email, QA_PASSWORD)).toBeNull();
    expect(await prisma.organization.findUnique({ where: { slug: QA_ORG_SLUG } })).toBeNull();
  });

  test("el login QA crea la empresa de prueba y se puede repetir", async () => {
    useQaEnv();
    await removeQaAccount();
    expect(await authenticate(QA_EMAIL, "otra-clave-2026")).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: QA_EMAIL } })).toBeNull();

    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(capture);
    const errorLog = vi.spyOn(console, "error").mockImplementation(capture);
    let session: Awaited<ReturnType<typeof authenticate>> = null;
    try {
      session = await authenticate(QA_EMAIL, QA_PASSWORD);
    } finally {
      log.mockRestore();
      errorLog.mockRestore();
    }
    expect(logs.join("\n")).not.toContain(QA_PASSWORD);
    expect(session?.email).toBe(QA_EMAIL);
    expect(session?.name).toBe(QA_USER_NAME);
    expect(session?.organizationName).toBe(QA_ORG_NAME);
    expect(session?.role).toBe("OWNER");
    expect(session && "passwordHash" in session).toBe(false);
    expect(JSON.stringify(session)).not.toContain(QA_PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: QA_EMAIL } });
    expect(user.name).toBe(QA_USER_NAME);
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(user.consentAt).toBeTruthy();
    expect(await verifyPassword(QA_PASSWORD, user.passwordHash)).toBe(true);
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: QA_ORG_SLUG } });
    expect(organization.isQa).toBe(true);
    expect(organization.suspendedAt).toBeNull();
    expect(organization.name).toBe(QA_ORG_NAME);
    expect(session?.organizationId).toBe(organization.id);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_agent: { organizationId: organization.id, agent: "ACCOUNTING" } },
    });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.periodEnd.getTime()).toBeGreaterThan(Date.now() + QA_ACCESS_MS - 60_000);
    expect(subscription.periodEnd.getTime()).toBeLessThan(Date.now() + QA_ACCESS_MS + 60_000);
    expect(subscription.amountClp).toBeNull();
    expect(subscription.mpPreapprovalId).toBeNull();

    const again = await authenticate(` ${QA_EMAIL.toUpperCase()} `, QA_PASSWORD);
    expect(again?.userId).toBe(user.id);
    expect(again?.organizationId).toBe(organization.id);
    expect(await prisma.user.count({ where: { email: QA_EMAIL } })).toBe(1);
    expect(await prisma.subscription.count({ where: { organizationId: organization.id } })).toBe(1);
    await removeQaAccount();
  });

  test("medición y cobro ignoran la empresa de prueba y siguen para una normal", async () => {
    const qa = await makeOrg("qa-medicion", true);
    const normal = await makeOrg("cliente-medicion", false);
    const now = new Date("2026-11-15T15:00:00.000Z");
    await prisma.usageMeter.create({
      data: { organizationId: qa.organizationId, kind: "CHAT", inputTokens: 800, outputTokens: 40, model: "grok-4.7" },
    });
    await prisma.usageEvent.create({
      data: {
        organizationId: qa.organizationId,
        agent: "ACCOUNTING",
        metric: "CONSULTS",
        quantity: 3,
        inputTokens: 800,
        outputTokens: 40,
        model: "grok-4.7",
      },
    });

    await recordMeter({
      organizationId: qa.organizationId,
      kind: "CHAT",
      model: "grok-4.7",
      tokens: { inputTokens: 500, outputTokens: 20 },
      now,
    });
    await prisma.$transaction(async (tx) => {
      const reserved = await reserveUsage(tx, {
        organizationId: qa.organizationId,
        agent: "ACCOUNTING",
        metric: "CONSULTS",
        quantity: 1,
        tokens: { inputTokens: 500, cachedTokens: 0, outputTokens: 20 },
        model: "grok-4.7",
        now,
      });
      expect(reserved.ok).toBe(true);
    });

    expect(await prisma.usageMeter.count({ where: { organizationId: qa.organizationId } })).toBe(1);
    expect(await prisma.usageMonth.count({ where: { organizationId: qa.organizationId } })).toBe(0);
    expect(await prisma.usageEvent.count({ where: { organizationId: qa.organizationId } })).toBe(1);
    const bill = await companyMeter(qa.organizationId, now);
    expect(bill.tasks).toBe(0);
    expect(bill.clientClp).toBe(0);
    expect(bill.clientUsd).toBe(0);
    expect(bill.xaiUsd).toBe(0);
    expect(bill.tokens.inputTokens).toBe(0);
    expect(bill.fixedPriceClp).toBeNull();
    const snapshot = await usageSnapshot(qa.organizationId, now);
    expect(snapshot.totals.CONSULTS).toBe(0);
    expect(snapshot.costClp).toBe(0);

    await recordMeter({
      organizationId: normal.organizationId,
      kind: "TASK",
      model: "grok-4.3",
      tokens: { inputTokens: 12, outputTokens: 4 },
      now,
    });
    const normalBill = await companyMeter(normal.organizationId, now);
    expect(normalBill.tasks).toBe(1);
    expect(normalBill.tokens.inputTokens).toBe(12);

    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ id: "pre-qa", init_point: "https://www.mercadopago.cl/no" }));
    await expect(
      startMercadoPagoSubscription(
        { organizationId: qa.organizationId, agent: "ACCOUNTING", payerEmail: qa.email, amountClp: 63546 },
        fetchMock,
      ),
    ).rejects.toBeInstanceOf(QaSinCobroError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.subscription.count({ where: { organizationId: qa.organizationId } })).toBe(0);
    await expect(
      startFlowSubscription({
        organizationId: qa.organizationId,
        organizationName: "QA",
        email: qa.email,
        name: "QA",
        agent: "ACCOUNTING",
      }),
    ).rejects.toBeInstanceOf(QaSinCobroError);
    expect(await activateMockPlan(qa.organizationId, "ACCOUNTING", now)).toEqual({ ok: false });
    expect(await prisma.subscription.count({ where: { organizationId: qa.organizationId } })).toBe(0);
  });
});
