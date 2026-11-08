import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { streamChatTurn } from "@/lib/chat/run";
import { tasksToday } from "@/lib/meter-store";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/lib/usage";
import * as xai from "@/lib/xai/client";
import { USAGE_PRESETS } from "@/lib/pricing";
import type { XaiStreamEvent } from "@/lib/xai/types";

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const BASELINE = 4;

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `falla-${suffix}@test.local`,
      name: "Ana",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: { role: "OWNER", organization: { create: { name: "Falla", slug: `falla-${suffix}` } } },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("sin empresa");
  createdOrgs.push(organizationId);
  const now = new Date();
  await prisma.usageMonth.create({
    data: { organizationId, yearMonth: monthKey(now), tasksCount: BASELINE },
  });
  for (let index = 0; index < BASELINE; index += 1) {
    await prisma.usageMeter.create({
      data: { organizationId, kind: "TASK", model: "", createdAt: now },
    });
  }
  return organizationId;
}

async function counts(organizationId: string) {
  const now = new Date();
  const month = await prisma.usageMonth.findUniqueOrThrow({
    where: { organizationId_yearMonth: { organizationId, yearMonth: monthKey(now) } },
  });
  return { tasks: await tasksToday(organizationId, now), tasksCount: month.tasksCount };
}

async function drain(organizationId: string, text: string, signal?: AbortSignal) {
  const events = [];
  for await (const event of streamChatTurn({
    organizationId,
    organizationName: "Falla",
    actorUserId: "user",
    text,
    files: [],
    signal,
  })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("la reserva no se pierde si el contexto falla", () => {
  test("si el historial falla, el cupo vuelve y el modelo no parte", async () => {
    const organizationId = await makeOrg();
    const model = vi.spyOn(xai, "createXaiClient");
    vi.spyOn(prisma.agentMessage, "findMany").mockRejectedValue(new Error("historial-falla"));
    await expect(drain(organizationId, "Resume el IVA en dos frases")).rejects.toThrow("historial-falla");
    expect(await counts(organizationId)).toEqual({ tasks: BASELINE, tasksCount: BASELINE });
    expect(model).not.toHaveBeenCalled();
    expect(await prisma.agentMessage.count({ where: { thread: { organizationId }, role: "ASSISTANT" } })).toBe(0);
  });

  test("si se aborta mientras se lee el historial, el cupo vuelve y el modelo no parte", async () => {
    const organizationId = await makeOrg();
    const model = vi.spyOn(xai, "createXaiClient");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = prisma.agentMessage.findMany.bind(prisma.agentMessage);
    vi.spyOn(prisma.agentMessage, "findMany").mockImplementation((async (args: unknown) => {
      await gate;
      return original(args as never);
    }) as typeof prisma.agentMessage.findMany);
    const controller = new AbortController();
    const running = drain(organizationId, "Resume el IVA en dos frases", controller.signal);
    await vi.waitFor(async () => {
      expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);
    });
    controller.abort();
    release();
    await running;
    expect(await counts(organizationId)).toEqual({ tasks: BASELINE, tasksCount: BASELINE });
    expect(model).not.toHaveBeenCalled();
  });

  test("veinte ejemplos se completan en otro tramo y un corte se declara", async () => {
    const organizationId = await makeOrg();
    let calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: "delta", text: "1. Ejemplo uno\n" };
          yield {
            type: "done",
            response: {
              id: "r1",
              model: "grok-4.7",
              outputText: "1. Ejemplo uno\n",
              usage: USAGE_PRESETS.text,
              mocked: true,
              incomplete: true,
            },
          };
          return;
        }
        const rest = Array.from({ length: 19 }, (_, index) => `${index + 2}. Ejemplo ${index + 2}`).join("\n");
        yield { type: "delta", text: rest };
        yield {
          type: "done",
          response: {
            id: "r2",
            model: "grok-4.7",
            outputText: rest,
            usage: USAGE_PRESETS.text,
            mocked: true,
            incomplete: false,
          },
        };
      },
    }));
    const events = await drain(organizationId, "Dame 20 ejemplos completos de asientos simples");
    const saved = events.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const body = saved && saved.type === "message" ? saved.message.body : "";
    expect(body).toContain("1. Ejemplo uno");
    expect(body).toContain("20. Ejemplo 20");
    expect(body).not.toContain("quedó cortada");
    expect(calls).toBe(2);
    expect((await counts(organizationId)).tasks).toBe(BASELINE + 1);

    calls = 0;
    vi.spyOn(xai, "createXaiClient").mockImplementation(() => ({
      async respond() {
        throw new Error("no");
      },
      async *streamRespond(): AsyncGenerator<XaiStreamEvent> {
        calls += 1;
        yield { type: "delta", text: `tramo ${calls}. ` };
        yield {
          type: "done",
          response: {
            id: `c${calls}`,
            model: "grok-4.7",
            outputText: `tramo ${calls}. `,
            usage: USAGE_PRESETS.text,
            mocked: true,
            incomplete: true,
          },
        };
      },
    }));
    const cut = await drain(organizationId, "Desarrolla el fundamento completo del IVA");
    const cutSaved = cut.find((event) => event.type === "message" && event.message.role === "ASSISTANT");
    const cutBody = cutSaved && cutSaved.type === "message" ? cutSaved.message.body : "";
    expect(cutBody).toContain("tramo 1");
    expect(cutBody).toContain("tramo 4");
    expect(cutBody).toContain("quedó cortada antes de terminar lo pedido");
    expect(calls).toBe(4);
  });
});
