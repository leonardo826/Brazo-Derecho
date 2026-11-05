import { afterAll, describe, expect, test } from "vitest";
import { companyMeter, recordComputerStep, recordMeter, recordModelCall } from "@/lib/meter-store";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { usedThisMonth } from "@/lib/usage-store";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeOrg(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@test.local`,
      name: label,
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: label, slug: `${label}-${suffix}` } },
        },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  createdOrgs.push(user.memberships[0].organizationId);
  return user.memberships[0].organizationId;
}

afterAll(async () => {
  if (createdOrgs.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  }
  if (createdUsers.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  }
  await prisma.$disconnect();
});

describe("agregado mensual de consumo", () => {
  test("suma tareas y tokens de una empresa y no los mezcla con otra", async () => {
    const ferreteria = await makeOrg("ferreteria-medicion");
    const cafe = await makeOrg("cafe-medicion");
    const now = new Date("2026-11-15T15:00:00.000Z");

    await recordModelCall({
      organizationId: ferreteria,
      now,
      response: {
        model: "grok-4.3",
        usage: { inputTokens: 1000, cachedTokens: 250, outputTokens: 40 },
        mocked: false,
      },
    });
    await recordComputerStep({
      organizationId: ferreteria,
      now,
      model: "computador",
      tokens: { inputTokens: 15, cachedTokens: 0, outputTokens: 5 },
    });
    await recordMeter({ organizationId: ferreteria, kind: "TASK", model: "grok-4.3", now });
    await recordModelCall({
      organizationId: cafe,
      now,
      response: {
        model: "grok-4.7",
        usage: { inputTokens: 80, cachedTokens: 0, outputTokens: 8 },
        mocked: true,
      },
    });

    const left = await companyMeter(ferreteria, now);
    const right = await companyMeter(cafe, now);
    expect(left.tasks).toBe(1);
    expect(left.tokens).toEqual({ inputTokens: 1015, cachedTokens: 250, outputTokens: 45 });
    expect(left.apiTokens).toEqual({ inputTokens: 1015, cachedTokens: 250, outputTokens: 45 });
    expect(left.simulatorTokens.inputTokens).toBe(0);
    expect(right.tasks).toBe(0);
    expect(right.tokens.inputTokens).toBe(80);
    expect(right.simulatorTokens).toEqual({ inputTokens: 80, cachedTokens: 0, outputTokens: 8 });
    expect(right.apiTokens.inputTokens).toBe(0);
    expect(right.clientClp).toBe(0);

    await recordMeter({ organizationId: ferreteria, kind: "TASK", now });
    const again = await companyMeter(ferreteria, now);
    expect(again.tasks).toBe(2);
    expect(again.tokens.inputTokens).toBe(1015);

    const stored = await prisma.usageMonth.findUnique({
      where: { organizationId_yearMonth: { organizationId: ferreteria, yearMonth: "2026-11" } },
    });
    expect(stored?.tasksCount).toBe(2);
    expect(await usedThisMonth(ferreteria, "RESPONSES", now)).toBe(0);
  });
});
