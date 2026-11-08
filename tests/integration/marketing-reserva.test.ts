import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

const { cookieJar, headerJar, faults } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  headerJar: new Map<string, string>(),
  faults: { recordModelCall: false, draftImageSvg: false },
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

vi.mock("@/lib/meter-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meter-store")>();
  return {
    ...actual,
    recordModelCall: async (...args: Parameters<typeof actual.recordModelCall>) => {
      if (faults.recordModelCall) throw new Error("meter-falla");
      return actual.recordModelCall(...args);
    },
  };
});

vi.mock("@/lib/agents/marketing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/marketing")>();
  return {
    ...actual,
    draftImageSvg: (...args: Parameters<typeof actual.draftImageSvg>) => {
      if (faults.draftImageSvg) throw new Error("svg-falla");
      return actual.draftImageSvg(...args);
    },
  };
});

import { generatePostsAction } from "@/app/actions/marketing";
import { createQuoteAction } from "@/app/actions/quotes";
import { runWhatsappTurn } from "@/lib/agents/run-whatsapp";
import type { AgentId } from "@/lib/catalog";
import { CSRF_COOKIE } from "@/lib/csrf-token";
import { SESSION_COOKIE } from "@/lib/cookie";
import { tasksToday } from "@/lib/meter-store";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { createSessionToken } from "@/lib/session-token";
import { monthKey } from "@/lib/usage";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const BASELINE = 4;

async function makeCompany(agent: AgentId) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: { email: `${agent}-${suffix}@test.local`, name: "Ana", passwordHash: await hashPassword("Clave-demo-2026") },
  });
  createdUsers.push(user.id);
  const organization = await prisma.organization.create({
    data: { name: agent, slug: `${agent}-${suffix}` },
  });
  createdOrgs.push(organization.id);
  await prisma.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      agent,
      status: "TRIAL",
      periodStart: now,
      periodEnd: new Date(now.getTime() + 7 * 86_400_000),
    },
  });
  await prisma.usageMonth.create({
    data: { organizationId: organization.id, yearMonth: monthKey(now), tasksCount: BASELINE },
  });
  for (let index = 0; index < BASELINE; index += 1) {
    await prisma.usageMeter.create({
      data: { organizationId: organization.id, kind: "TASK", model: "", createdAt: now },
    });
  }
  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: organization.id,
    organizationName: organization.name,
    role: "OWNER",
    authVersion: user.authVersion,
  });
  cookieJar.set(SESSION_COOKIE, token);
  cookieJar.set(CSRF_COOKIE, "a".repeat(32));
  headerJar.set("origin", "http://localhost:3000");
  headerJar.set("host", "localhost:3000");
  return organization;
}

function csrfForm() {
  const form = new FormData();
  form.set("csrf", "a".repeat(32));
  return form;
}

async function quoteCounts(organizationId: string) {
  const now = new Date();
  const month = await prisma.usageMonth.findUniqueOrThrow({
    where: { organizationId_yearMonth: { organizationId, yearMonth: monthKey(now) } },
  });
  return { tasks: await tasksToday(organizationId, now), tasksCount: month.tasksCount };
}

async function expectBaseline(organizationId: string) {
  const counts = await quoteCounts(organizationId);
  expect(counts.tasks).toBe(BASELINE);
  expect(counts.tasksCount).toBe(BASELINE);
}

afterEach(() => {
  faults.recordModelCall = false;
  faults.draftImageSvg = false;
  cookieJar.clear();
  headerJar.clear();
  resetRateLimits();
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("la reserva de marketing se suelta si el guardado falla", () => {
  test("createMany que lanza devuelve el cupo del día y del mes una sola vez", async () => {
    const org = await makeCompany("MARKETING");
    await prisma.brandProfile.create({
      data: { organizationId: org.id, voice: "cercana", audience: "vecinos", summary: "Panadería de barrio" },
    });
    const original = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown, options?: unknown) => {
      if (typeof arg !== "function") return original(arg as never, options as never);
      return original(async (tx: { marketingPost: { createMany: () => Promise<unknown> } }) => {
        tx.marketingPost.createMany = () => Promise.reject(new Error("createMany-falla"));
        return (arg as (client: unknown) => Promise<unknown>)(tx);
      }, options as never);
    }) as typeof prisma.$transaction);

    const form = csrfForm();
    form.set("count", "1");
    form.set("withImage", "on");
    await expect(generatePostsAction(form)).rejects.toThrow("REDIRECT:/panel/marketing?error=ia");
    await expectBaseline(org.id);
    expect(await prisma.marketingPost.count({ where: { organizationId: org.id } })).toBe(0);
  });

  test("recordModelCall que lanza no deja la reserva del texto", async () => {
    const org = await makeCompany("MARKETING");
    await prisma.brandProfile.create({
      data: { organizationId: org.id, voice: "cercana", audience: "vecinos", summary: "Panadería de barrio" },
    });
    faults.recordModelCall = true;
    const form = csrfForm();
    form.set("count", "1");
    form.set("withImage", "on");
    await expect(generatePostsAction(form)).rejects.toThrow("REDIRECT:/panel/marketing?error=ia");
    await expectBaseline(org.id);
  });

  test("draftImageSvg que lanza suelta la reserva del texto y la de la imagen", async () => {
    const org = await makeCompany("MARKETING");
    await prisma.brandProfile.create({
      data: { organizationId: org.id, voice: "cercana", audience: "vecinos", summary: "Panadería de barrio" },
    });
    faults.draftImageSvg = true;
    const form = csrfForm();
    form.set("count", "1");
    form.set("withImage", "on");
    await expect(generatePostsAction(form)).rejects.toThrow("REDIRECT:/panel/marketing?error=ia");
    await expectBaseline(org.id);
    expect(await prisma.marketingPost.count({ where: { organizationId: org.id } })).toBe(0);
  });

  test("un borrador guardado conserva las dos reservas y no las suelta dos veces", async () => {
    const org = await makeCompany("MARKETING");
    await prisma.brandProfile.create({
      data: { organizationId: org.id, voice: "cercana", audience: "vecinos", summary: "Panadería de barrio" },
    });
    const form = csrfForm();
    form.set("count", "1");
    form.set("withImage", "on");
    await expect(generatePostsAction(form)).rejects.toThrow("REDIRECT:/panel/marketing?ok=borradores");
    const counts = await quoteCounts(org.id);
    expect(counts.tasks).toBe(BASELINE + 2);
    expect(counts.tasksCount).toBe(BASELINE + 2);
    expect(await prisma.marketingPost.count({ where: { organizationId: org.id } })).toBe(1);
  });
});

describe("cotización y WhatsApp sueltan la reserva si el medidor falla", () => {
  test("la cotización no deja la tarea si recordModelCall lanza", async () => {
    const org = await makeCompany("QUOTES");
    const item = await prisma.priceItem.create({
      data: { organizationId: org.id, sku: "PAN", name: "Pan", unit: "un", priceClp: 1000 },
    });
    faults.recordModelCall = true;
    const form = csrfForm();
    form.set("customerName", "Ana Cliente");
    form.set("notes", "");
    form.set("pedidoLibre", "");
    form.append("priceItemId", item.id);
    form.append("quantity", "1");
    await expect(createQuoteAction(form)).rejects.toThrow("meter-falla");
    await expectBaseline(org.id);
    expect(await prisma.quote.count({ where: { organizationId: org.id } })).toBe(0);
  });

  test("WhatsApp no deja la tarea si recordModelCall lanza", async () => {
    const org = await makeCompany("WHATSAPP");
    const conversation = await prisma.conversation.create({
      data: { organizationId: org.id, customerLabel: "Cliente" },
    });
    faults.recordModelCall = true;
    await expect(
      runWhatsappTurn({
        organizationId: org.id,
        organizationName: org.name,
        conversationId: conversation.id,
        question: "¿A qué hora abren?",
      }),
    ).rejects.toThrow("meter-falla");
    await expectBaseline(org.id);
    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(0);
  });
});
