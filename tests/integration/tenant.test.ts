import { afterAll, describe, expect, test, vi } from "vitest";
import { agentIsOpen } from "@/lib/agent-access";
import { callWithinPlan } from "@/lib/plan-limit";
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
    await prisma.quote.deleteMany({ where: { organizationId: { in: createdOrgs } } });
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

    const call = vi.fn(async () => "no debía llamar a xAI");
    const gated = await callWithinPlan({
      organizationId: ferreteria,
      checks: [{ agent: "WHATSAPP", metric: "RESPONSES", quantity: 1 }],
      call,
    });
    expect(gated.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  test("una empresa no lee ni modifica cotizaciones, hilos ni borradores de la otra", async () => {
    const taller = await makeOrg("taller");
    const panaderia = await makeOrg("panaderia");
    const price = await prisma.priceItem.create({
      data: { organizationId: panaderia, sku: "SEC-1", name: "Producto secreto", unit: "unidad", priceClp: 1000 },
    });
    const quote = await prisma.quote.create({
      data: {
        organizationId: panaderia,
        number: 1,
        customerName: "Cliente secreto",
        totalClp: 1000,
        lines: {
          create: {
            priceItemId: price.id,
            description: "Producto secreto",
            unit: "unidad",
            quantity: 1,
            unitPriceClp: 1000,
          },
        },
      },
    });
    await prisma.conversation.create({
      data: {
        organizationId: panaderia,
        customerLabel: "Cliente secreto",
        externalId: `secreto-${panaderia}`,
        messages: { create: { role: "CUSTOMER", body: "dato privado de la panadería" } },
      },
    });
    await prisma.marketingPost.create({
      data: { organizationId: panaderia, title: "Borrador secreto", channel: "Instagram", copy: "no publicar" },
    });
    await prisma.brandProfile.create({
      data: { organizationId: panaderia, voice: "secreta", audience: "nadie", summary: "privado" },
    });
    await prisma.knowledgeItem.create({
      data: { organizationId: panaderia, title: "Receta", body: "La receta no sale de esta empresa." },
    });

    expect(await prisma.quote.findFirst({ where: { id: quote.id, organizationId: taller } })).toBeNull();
    expect(await prisma.priceItem.findFirst({ where: { id: price.id, organizationId: taller } })).toBeNull();
    expect(await prisma.conversation.findFirst({ where: { organizationId: taller, customerLabel: "Cliente secreto" } })).toBeNull();
    expect(
      await prisma.message.findFirst({
        where: { body: "dato privado de la panadería", conversation: { organizationId: taller } },
      }),
    ).toBeNull();
    expect(await prisma.marketingPost.findFirst({ where: { organizationId: taller, title: "Borrador secreto" } })).toBeNull();
    expect(await prisma.brandProfile.findUnique({ where: { organizationId: taller } })).toBeNull();
    expect(await prisma.knowledgeItem.findFirst({ where: { organizationId: taller, title: "Receta" } })).toBeNull();

    const stolen = await prisma.quote.updateMany({
      where: { id: quote.id, organizationId: taller },
      data: { notes: "robado" },
    });
    expect(stolen.count).toBe(0);
    const kept = await prisma.quote.findFirst({ where: { id: quote.id, organizationId: panaderia } });
    expect(kept?.notes).toBe("");
    expect(kept?.customerName).toBe("Cliente secreto");

    await prisma.organization.update({ where: { id: taller }, data: { suspendedAt: new Date() } });
    const blocked = await agentIsOpen(taller, "WHATSAPP");
    const open = await agentIsOpen(panaderia, "QUOTES");
    expect(blocked.suspended).toBe(true);
    expect(blocked.open).toBe(false);
    expect(open.suspended).toBe(false);
  });
});
