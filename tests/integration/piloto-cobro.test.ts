import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { applyFlowToken } from "@/lib/flow/apply";
import { applyMercadoPagoResource } from "@/lib/mercadopago/apply";
import { tasksToday } from "@/lib/meter-store";
import { hashPassword } from "@/lib/password";
import { planRoom } from "@/lib/plan-limit";
import { prisma } from "@/lib/prisma";
import { DAILY_TASK_LIMIT } from "@/lib/usage";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeUser(email: string) {
  const user = await prisma.user.create({
    data: { email, name: "Ana", passwordHash: await hashPassword("Clave-demo-2026") },
  });
  createdUsers.push(user.id);
  return user;
}

async function makeOrg(name: string) {
  const organization = await prisma.organization.create({
    data: { name, slug: `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}` },
  });
  createdOrgs.push(organization.id);
  return organization;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FLOW_API_KEY;
  delete process.env.FLOW_SECRET_KEY;
});

afterAll(async () => {
  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId: { in: createdOrgs } },
    select: { id: true },
  });
  const ids = subscriptions.map((item) => item.id);
  if (ids.length > 0) await prisma.mercadoPagoNotice.deleteMany({ where: { subscriptionId: { in: ids } } });
  if (createdOrgs.length > 0) {
    await prisma.flowNotice.deleteMany({
      where: { OR: [{ organizationId: { in: createdOrgs } }, { token: "token-sin-empresa" }] },
    });
    await prisma.usageMeter.deleteMany({ where: { organizationId: { in: createdOrgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  }
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("aislamiento del cobro de prueba", () => {
  test("el correo del pagador no activa la empresa más antigua", async () => {
    process.env.FLOW_API_KEY = "api-prueba";
    process.env.FLOW_SECRET_KEY = "secreto-prueba";
    const user = await makeUser(`dos-${Date.now()}@test.local`);
    const older = await makeOrg("Antigua");
    const newer = await makeOrg("Nueva");
    await prisma.membership.create({ data: { userId: user.id, organizationId: older.id, role: "OWNER" } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: newer.id, role: "OWNER" } });
    const now = new Date();
    for (const organizationId of [older.id, newer.id]) {
      await prisma.subscription.create({
        data: {
          organizationId,
          agent: "WHATSAPP",
          status: "TRIAL",
          periodStart: now,
          periodEnd: new Date(now.getTime() + 7 * 86_400_000),
        },
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: 2,
          amount: 47588,
          payer: user.email,
          flowOrder: 9001,
        }),
      ),
    );

    const applied = await applyFlowToken("token-sin-empresa");
    expect(applied.ok).toBe(true);
    expect(applied.organizationId ?? null).toBeNull();
    for (const organizationId of [older.id, newer.id]) {
      const row = await prisma.subscription.findUniqueOrThrow({
        where: { organizationId_agent: { organizationId, agent: "WHATSAPP" } },
      });
      expect(row.status).toBe("TRIAL");
    }
  });

  test("un pago con referencia de una empresa y preapproval de otra no cambia ninguna", async () => {
    const left = await makeOrg("Izquierda");
    const right = await makeOrg("Derecha");
    const now = new Date();
    const a = await prisma.subscription.create({
      data: {
        organizationId: left.id,
        agent: "ACCOUNTING",
        status: "TRIAL",
        periodStart: now,
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
        mpPreapprovalId: "pre-izquierda",
      },
    });
    const b = await prisma.subscription.create({
      data: {
        organizationId: right.id,
        agent: "ACCOUNTING",
        status: "TRIAL",
        periodStart: now,
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
        mpPreapprovalId: "pre-derecha",
      },
    });

    const applied = await applyMercadoPagoResource({
      topic: "payment",
      dataId: "pago-cruzado",
      resource: {
        id: "pago-cruzado",
        status: "approved",
        external_reference: a.id,
        preapproval_id: "pre-derecha",
      },
    });
    expect(applied.updated).toBe(false);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("TRIAL");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("TRIAL");
  });

  test("la tarea 30 del día corta la siguiente llamada y la cuenta QA no entra en el cupo", async () => {
    const org = await makeOrg("Cupo");
    const qa = await prisma.organization.create({
      data: { name: "QA cupo", slug: `qa-cupo-${Date.now()}`, isQa: true },
    });
    createdOrgs.push(qa.id);
    const now = new Date();
    for (let index = 0; index < DAILY_TASK_LIMIT; index += 1) {
      await prisma.usageMeter.create({
        data: { organizationId: org.id, kind: "TASK", model: "grok-4.7", createdAt: now },
      });
      await prisma.usageMeter.create({
        data: { organizationId: qa.id, kind: "TASK", model: "grok-4.7", createdAt: now },
      });
    }
    expect(await tasksToday(org.id, now)).toBe(DAILY_TASK_LIMIT);
    expect(await tasksToday(qa.id, now)).toBe(0);
    const blocked = await planRoom({
      organizationId: org.id,
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      now,
      loadUsed: async () => 0,
      loadTasks: tasksToday,
    });
    expect(blocked.ok).toBe(false);
    const qaRoom = await planRoom({
      organizationId: qa.id,
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      now,
      loadUsed: async () => 0,
      loadTasks: tasksToday,
    });
    expect(qaRoom.ok).toBe(true);
  });
});
