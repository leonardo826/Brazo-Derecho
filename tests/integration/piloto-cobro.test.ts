import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

const { cookieJar, headerJar } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  headerJar: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) => headerJar.get(name.toLowerCase()) ?? null,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { activateTrialAction } from "@/app/actions/subscriptions";
import { CSRF_COOKIE } from "@/lib/csrf-token";
import { SESSION_COOKIE } from "@/lib/cookie";
import { applyFlowToken } from "@/lib/flow/apply";
import { applyMercadoPagoResource } from "@/lib/mercadopago/apply";
import { releaseDailyTask, reserveDailyTask, tasksToday } from "@/lib/meter-store";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { createSessionToken } from "@/lib/session-token";
import { beginTrialIfIdle } from "@/lib/trial-guard";
import { DAILY_TASK_LIMIT, monthKey } from "@/lib/usage";

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
  cookieJar.clear();
  headerJar.clear();
  delete process.env.FLOW_API_KEY;
  delete process.env.FLOW_SECRET_KEY;
  delete process.env.MERCADOPAGO_ACCESS_TOKEN;
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
    const blocked = await reserveDailyTask(org.id, now);
    expect(blocked.ok).toBe(false);
    const qaSlots = await Promise.all([reserveDailyTask(qa.id, now), reserveDailyTask(qa.id, now)]);
    expect(qaSlots.every((slot) => slot.ok && slot.reservationId === null)).toBe(true);
    expect(await tasksToday(qa.id, now)).toBe(0);
  });

  test("29 tareas y dos reservas simultáneas dejan una sola y se puede soltar", async () => {
    const org = await makeOrg("Carrera");
    const now = new Date();
    for (let index = 0; index < DAILY_TASK_LIMIT - 1; index += 1) {
      await prisma.usageMeter.create({
        data: { organizationId: org.id, kind: "TASK", model: "", createdAt: now },
      });
    }
    const [first, second] = await Promise.all([reserveDailyTask(org.id, now), reserveDailyTask(org.id, now)]);
    const won = [first, second].filter((slot) => slot.ok);
    const lost = [first, second].filter((slot) => !slot.ok);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(await tasksToday(org.id, now)).toBe(DAILY_TASK_LIMIT);
    const reservationId = won[0] && won[0].ok ? won[0].reservationId : null;
    await Promise.all([releaseDailyTask(reservationId), releaseDailyTask(reservationId)]);
    expect(await tasksToday(org.id, now)).toBe(DAILY_TASK_LIMIT - 1);
    const month = await prisma.usageMonth.findUniqueOrThrow({
      where: { organizationId_yearMonth: { organizationId: org.id, yearMonth: monthKey(now) } },
    });
    expect(month.tasksCount).toBe(0);
    const again = await reserveDailyTask(org.id, now);
    expect(again.ok).toBe(true);
  });

  test("una tarea al cerrar el día de Chile no cuenta en el día siguiente", async () => {
    const org = await makeOrg("LimiteDia");
    const now = new Date("2026-09-06T03:30:00.000Z");
    const { start, end } = (await import("@/lib/usage")).dayBounds(now);
    await prisma.usageMeter.create({
      data: { organizationId: org.id, kind: "TASK", model: "", createdAt: new Date(end.getTime() - 1000) },
    });
    await prisma.usageMeter.create({
      data: { organizationId: org.id, kind: "TASK", model: "", createdAt: end },
    });
    expect(await tasksToday(org.id, new Date(end.getTime() - 1000))).toBe(1);
    expect(await tasksToday(org.id, end)).toBe(1);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  test("abrir la prueba no baja un plan que un aviso de pago dejó activo", async () => {
    const org = await makeOrg("CarreraPlan");
    const now = new Date();
    const paidUntil = new Date(now.getTime() + 20 * 86_400_000);
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        agent: "ACCOUNTING",
        status: "ACTIVE",
        periodStart: now,
        periodEnd: paidUntil,
        provider: "MERCADOPAGO",
        mpPreapprovalId: `pre-${org.id}`,
      },
    });
    const gates = await Promise.all([
      beginTrialIfIdle({ organizationId: org.id, agent: "ACCOUNTING", now }),
      beginTrialIfIdle({ organizationId: org.id, agent: "ACCOUNTING", now }),
      applyMercadoPagoResource({
        topic: "payment",
        dataId: `pago-${org.id}`,
        now,
        resource: {
          id: `pago-${org.id}`,
          status: "approved",
          external_reference: subscription.id,
          preapproval_id: subscription.mpPreapprovalId,
        },
      }),
    ]);
    expect(gates.filter((gate) => gate === "opened")).toHaveLength(0);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.periodEnd.getTime()).toBeGreaterThanOrEqual(paidUntil.getTime());
  });

  test("dos avisos iguales y dos opuestos no cruzan ni duplican la suscripción", async () => {
    const org = await makeOrg("Avisos");
    const other = await makeOrg("Ajena");
    const now = new Date();
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        agent: "WHATSAPP",
        status: "TRIAL",
        periodStart: new Date(now.getTime() - 10 * 86_400_000),
        periodEnd: new Date(now.getTime() - 86_400_000),
      },
    });
    const foreign = await prisma.subscription.create({
      data: {
        organizationId: other.id,
        agent: "WHATSAPP",
        status: "TRIAL",
        periodStart: now,
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
      },
    });
    const duplicate = {
      topic: "payment" as const,
      dataId: `dup-${org.id}`,
      now,
      resource: {
        id: `dup-${org.id}`,
        status: "approved",
        external_reference: subscription.id,
      },
    };
    const duplicated = await Promise.all([
      applyMercadoPagoResource(duplicate),
      applyMercadoPagoResource(duplicate),
    ]);
    expect(duplicated.some((item) => item.repeated)).toBe(true);
    expect(await prisma.mercadoPagoNotice.count({ where: { noticeKey: `pago:dup-${org.id}` } })).toBe(1);
    const once = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(once.status).toBe("ACTIVE");
    const periodEnd = once.periodEnd.getTime();

    await Promise.all([
      applyMercadoPagoResource({
        topic: "payment",
        dataId: `ok-${org.id}`,
        now,
        resource: { id: `ok-${org.id}`, status: "approved", external_reference: subscription.id },
      }),
      applyMercadoPagoResource({
        topic: "payment",
        dataId: `no-${org.id}`,
        now,
        resource: { id: `no-${org.id}`, status: "cancelled", external_reference: subscription.id },
      }),
    ]);
    const settled = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(["ACTIVE", "CANCELED"]).toContain(settled.status);
    expect(settled.organizationId).toBe(org.id);
    const untouched = await prisma.subscription.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.status).toBe("TRIAL");
    expect(untouched.periodEnd.getTime()).not.toBe(periodEnd);
  });

  test("dos avisos Flow iguales no se aplican dos veces y uno de prueba no baja el plan pagado", async () => {
    process.env.FLOW_API_KEY = "api-prueba";
    process.env.FLOW_SECRET_KEY = "secreto-prueba";
    const org = await makeOrg("FlowCarrera");
    const other = await makeOrg("FlowAjena");
    const now = new Date();
    const flowId = `flow-${org.id}`;
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        agent: "ACCOUNTING",
        status: "EXPIRED",
        periodStart: new Date(now.getTime() - 40 * 86_400_000),
        periodEnd: new Date(now.getTime() - 86_400_000),
        flowSubscriptionId: flowId,
      },
    });
    const foreign = await prisma.subscription.create({
      data: {
        organizationId: other.id,
        agent: "ACCOUNTING",
        status: "TRIAL",
        periodStart: now,
        periodEnd: new Date(now.getTime() + 7 * 86_400_000),
        flowSubscriptionId: `flow-${other.id}`,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("payment/getStatus")) {
          const token = new URL(url).searchParams.get("token") ?? "";
          return Response.json({
            status: token.includes("trial") ? 1 : 2,
            subscriptionId: flowId,
            flowOrder: token.includes("trial") ? 2 : 1,
          });
        }
        return Response.json({ status: 2, subscriptionId: flowId });
      }),
    );
    const paid = `paid-${org.id}`;
    const duplicated = await Promise.all([applyFlowToken(paid, now), applyFlowToken(paid, now)]);
    expect(duplicated.filter((item) => item.repeated)).toHaveLength(1);
    expect(await prisma.flowNotice.count({ where: { token: paid } })).toBe(1);
    const once = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(once.status).toBe("ACTIVE");
    const paidUntil = once.periodEnd.getTime();

    await Promise.all([applyFlowToken(`paid-again-${org.id}`, now), applyFlowToken(`trial-${org.id}`, now)]);
    const settled = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(settled.status).toBe("ACTIVE");
    expect(settled.periodEnd.getTime()).toBeGreaterThanOrEqual(paidUntil);
    expect(settled.organizationId).toBe(org.id);
    const untouched = await prisma.subscription.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.status).toBe("TRIAL");
    expect(untouched.organizationId).toBe(other.id);
  });

  test("activar la prueba a la vez que un pago no deja la suscripción en 7 días", async () => {
    const user = await makeUser(`accion-${Date.now()}@test.local`);
    const org = await makeOrg("Accion");
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    const paidUntil = new Date(now.getTime() + 40 * 86_400_000);
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        agent: "ACCOUNTING",
        status: "ACTIVE",
        provider: "MERCADOPAGO",
        periodStart: now,
        periodEnd: paidUntil,
        mpPreapprovalId: `pre-accion-${org.id}`,
      },
    });
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: org.id,
      organizationName: org.name,
      role: "OWNER",
      authVersion: user.authVersion,
    });
    cookieJar.set(SESSION_COOKIE, token);
    cookieJar.set(CSRF_COOKIE, "a".repeat(32));
    headerJar.set("origin", "http://localhost:3000");
    headerJar.set("host", "localhost:3000");
    const runAction = () => {
      const form = new FormData();
      form.set("csrf", "a".repeat(32));
      form.set("back", "/panel");
      form.set("agent", "ACCOUNTING");
      form.set("provider", "flow");
      return activateTrialAction(form).then(
        () => "ok",
        (error: unknown) => {
          const message = error instanceof Error ? error.message : "";
          if (message.startsWith("REDIRECT:")) return message;
          throw error;
        },
      );
    };
    const payment = applyMercadoPagoResource({
      topic: "payment",
      dataId: `accion-${org.id}`,
      now,
      resource: {
        id: `accion-${org.id}`,
        status: "approved",
        external_reference: subscription.id,
        preapproval_id: subscription.mpPreapprovalId,
      },
    });
    await Promise.all([runAction(), runAction(), payment]);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.periodEnd.getTime()).toBeGreaterThanOrEqual(paidUntil.getTime());
    expect(after.provider).toBe("MERCADOPAGO");
  });

  test("las ramas de Mercado Pago y Flow configuradas tampoco bajan un plan activo", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-accion-token";
    process.env.FLOW_API_KEY = "api-prueba";
    process.env.FLOW_SECRET_KEY = "secreto-prueba";
    process.env.APP_URL = "http://localhost:3000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("api.mercadopago.com")) {
          return Response.json({ id: "pre-nuevo", init_point: "https://sandbox.mercadopago.cl/checkout/start" });
        }
        if (url.includes("customer/create")) return Response.json({ customerId: "cus-accion" });
        if (url.includes("plans/")) return Response.json({ planId: "plan-contador" });
        if (url.includes("subscription/create")) return Response.json({ subscriptionId: "flow-nuevo" });
        if (url.includes("customer/register")) {
          return Response.json({ url: "https://sandbox.flow.cl/app/kpf/pagar", token: "tok-accion" });
        }
        return Response.json({});
      }),
    );
    const user = await makeUser(`medios-${Date.now()}@test.local`);
    const org = await makeOrg("Medios");
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    const paidUntil = new Date(now.getTime() + 40 * 86_400_000);
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: org.id,
        agent: "ACCOUNTING",
        status: "ACTIVE",
        provider: "MERCADOPAGO",
        periodStart: now,
        periodEnd: paidUntil,
        mpPreapprovalId: `pre-medios-${org.id}`,
      },
    });
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: org.id,
      organizationName: org.name,
      role: "OWNER",
      authVersion: user.authVersion,
    });
    cookieJar.set(SESSION_COOKIE, token);
    cookieJar.set(CSRF_COOKIE, "a".repeat(32));
    headerJar.set("origin", "http://localhost:3000");
    headerJar.set("host", "localhost:3000");

    async function run(provider: string) {
      const form = new FormData();
      form.set("csrf", "a".repeat(32));
      form.set("back", "/panel");
      form.set("agent", "ACCOUNTING");
      form.set("provider", provider);
      try {
        await activateTrialAction(form);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.startsWith("REDIRECT:")) throw error;
      }
    }

    await Promise.all([
      run("mercadopago"),
      run("flow"),
      applyMercadoPagoResource({
        topic: "payment",
        dataId: `medios-${org.id}`,
        now,
        resource: {
          id: `medios-${org.id}`,
          status: "approved",
          external_reference: subscription.id,
          preapproval_id: subscription.mpPreapprovalId,
        },
      }),
    ]);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.periodEnd.getTime()).toBeGreaterThanOrEqual(paidUntil.getTime());
  });
});
