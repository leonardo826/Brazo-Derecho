import { afterAll, describe, expect, test } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { reserveUsage } from "@/lib/usage-store";

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

describe("aislamiento entre empresas", () => {
  test("la lista y el cupo de una empresa no se ven en la otra", async () => {
    const ferreteria = await makeOrg("ferreteria");
    const cafe = await makeOrg("cafe");
    await prisma.priceItem.create({
      data: { organizationId: ferreteria, sku: "PIN-1G", name: "Pintura látex blanco", unit: "galón", priceClp: 18990 },
    });
    await prisma.knowledgeItem.create({
      data: { organizationId: cafe, title: "Horario de atención", body: "Abrimos todos los días de 8:30 a 20:00." },
    });

    const prices = await prisma.priceItem.findMany({ where: { organizationId: cafe } });
    const notes = await prisma.knowledgeItem.findMany({ where: { organizationId: ferreteria } });
    expect(prices).toHaveLength(0);
    expect(notes).toHaveLength(0);

    await prisma.usageEvent.create({
      data: { organizationId: ferreteria, agent: "WHATSAPP", metric: "RESPONSES", quantity: 1000 },
    });
    const blocked = await prisma.$transaction((tx) =>
      reserveUsage(tx, {
        organizationId: ferreteria,
        agent: "WHATSAPP",
        metric: "RESPONSES",
        quantity: 1,
      }),
    );
    const allowed = await prisma.$transaction((tx) =>
      reserveUsage(tx, {
        organizationId: cafe,
        agent: "WHATSAPP",
        metric: "RESPONSES",
        quantity: 1,
      }),
    );
    expect(blocked.ok).toBe(false);
    expect(allowed.ok).toBe(true);
  });
});
