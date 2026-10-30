import { afterAll, describe, expect, test } from "vitest";
import { GET } from "@/app/api/health/route";
import { activateMockPlan } from "@/lib/flow/mock-checkout";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { trialEnd } from "@/lib/subscription";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `pago-${suffix}@test.local`,
      name: "Ana Pago",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: "Pago", slug: `pago-${suffix}` } },
        },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("No quedó la empresa");
  createdOrgs.push(organizationId);
  return organizationId;
}

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("salud y pago de prueba", () => {
  test("GET /api/health revisa la base", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, servicio: "brazo-derecho", base: "ok" });
  });

  test("el pago de prueba deja el agente activo y no toca otra empresa", async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    const now = new Date();
    await prisma.subscription.create({
      data: {
        organizationId: org,
        agent: "WHATSAPP",
        status: "TRIAL",
        periodStart: now,
        periodEnd: trialEnd(now),
      },
    });
    await prisma.subscription.create({
      data: {
        organizationId: other,
        agent: "WHATSAPP",
        status: "TRIAL",
        periodStart: now,
        periodEnd: trialEnd(now),
      },
    });

    const activated = await activateMockPlan(org, "WHATSAPP", now);
    expect(activated).toEqual({ ok: true, already: false });

    const own = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_agent: { organizationId: org, agent: "WHATSAPP" } },
    });
    expect(own.status).toBe("ACTIVE");
    expect(own.amountClp).toBe(47588);
    expect(own.flowPlanId).toBe("brazo-whatsapp");
    expect(own.flowSubscriptionId).toBeNull();
    expect(own.periodEnd.getTime()).toBeGreaterThan(trialEnd(now).getTime());

    expect(await activateMockPlan(org, "WHATSAPP", now)).toEqual({ ok: true, already: true });

    const untouched = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_agent: { organizationId: other, agent: "WHATSAPP" } },
    });
    expect(untouched.status).toBe("TRIAL");

    await prisma.subscription.update({
      where: { id: own.id },
      data: { status: "CANCELED", periodEnd: now },
    });
    expect(await activateMockPlan(org, "WHATSAPP", now)).toEqual({ ok: false });
    expect(await activateMockPlan(org, "QUOTES", now)).toEqual({ ok: false });
  });
});
