import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import { reapIdleComputers } from "@/lib/computer/power";
import { prismaPowerStore } from "@/lib/computer/power-store";
import { fakeProvider } from "@/lib/computer/provider";
import { prisma } from "@/lib/prisma";

const created: string[] = [];
const meta = { provider: "static", machineId: "maq-1", epoch: 1 };

async function organization() {
  const row = await prisma.organization.create({
    data: {
      name: "Encendido",
      slug: `enc-${Date.now()}-${randomBytes(3).toString("hex")}`,
      isQa: true,
    },
  });
  created.push(row.id);
  return row.id;
}

afterAll(async () => {
  if (created.length > 0) await prisma.organization.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("prismaPowerStore", () => {
  test("seis arranques paralelos dejan un solo starter", async () => {
    const id = await organization();
    const store = prismaPowerStore();
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 6 }, () => store.claimStart(id, now, 60_000, meta)));
    expect(results.filter((item) => item.role === "starter")).toHaveLength(1);
    expect(results.filter((item) => item.role === "waiter")).toHaveLength(5);
    expect((await store.read(id))?.state).toBe("STARTING");
  });

  test("markOff anota los segundos una sola vez", async () => {
    const id = await organization();
    const store = prismaPowerStore();
    const started = new Date(Date.now() - 8_000);
    await prisma.computerPower.create({
      data: {
        organizationId: id,
        state: "STOPPING",
        generation: 3,
        provider: "static",
        machineId: "maq-1",
        powerOnAt: started,
        lastActivityAt: started,
      },
    });
    const now = Date.now();
    const [first, second] = await Promise.all([store.markOff(id, now), store.markOff(id, now)]);
    expect([first, second].filter((item) => item !== null)).toHaveLength(1);
    expect(await prisma.computerPowerUse.count({ where: { organizationId: id } })).toBe(1);
    expect((await store.read(id))?.state).toBe("OFF");
  });

  test("un apagado fallido queda en ERROR y se puede volver a tomar", async () => {
    const id = await organization();
    const store = prismaPowerStore();
    await prisma.computerPower.create({
      data: {
        organizationId: id,
        state: "STOPPING",
        generation: 2,
        provider: "static",
        machineId: "maq-1",
        claimExpiresAt: new Date(Date.now() + 60_000),
        lastActivityAt: new Date(Date.now() - 60_000),
      },
    });
    await store.failStop(id, Date.now());
    const failed = await store.read(id);
    expect(failed?.state).toBe("ERROR");
    expect(failed?.errorCode).toBe("apagado");
    expect((await store.claimStart(id, Date.now(), 60_000, meta)).role).toBe("starter");
  });

  test("ERROR y un STARTING vencido se vuelven a tomar", async () => {
    const id = await organization();
    const store = prismaPowerStore();
    const first = await store.claimStart(id, Date.now(), 30_000, meta);
    expect(first.role).toBe("starter");
    await prisma.computerPower.update({
      where: { organizationId: id },
      data: { claimExpiresAt: new Date(Date.now() - 1_000) },
    });
    const stolen = await store.claimStart(id, Date.now(), 30_000, meta);
    expect(stolen.role).toBe("starter");
    if (stolen.role !== "starter") return;
    await store.markError(id, stolen.generation, "tiempo", Date.now());
    expect((await store.read(id))?.state).toBe("ERROR");
    expect((await store.claimStart(id, Date.now(), 30_000, meta)).role).toBe("starter");
  });

  test("un contador colgado se suelta solo si la actividad no cambió", async () => {
    const id = await organization();
    const store = prismaPowerStore();
    const last = new Date(Date.now() - 40 * 60 * 1000);
    await prisma.computerPower.create({
      data: {
        organizationId: id,
        state: "READY",
        generation: 4,
        provider: "static",
        machineId: "maq-1",
        leaseEpoch: 1,
        activeTaskCount: 2,
        lastActivityAt: last,
        powerOnAt: last,
      },
    });
    const row = await store.read(id);
    expect(row).not.toBeNull();
    if (!row) return;
    expect(await store.clearStuckTasks(id, row.generation, row.lastActivityAt + 5)).toBe(false);
    expect((await store.read(id))?.activeTaskCount).toBe(2);

    const provider = fakeProvider();
    const kept = await reapIdleComputers({
      store,
      provider,
      idleMs: 15 * 60 * 1000,
      closeBrowser: async () => "busy",
    });
    expect(kept.stopped).toEqual([]);
    expect(provider.calls.stop).toBe(0);
    expect((await store.read(id))?.activeTaskCount).toBe(2);
    expect((await store.read(id))?.state).toBe("READY");

    const released = await reapIdleComputers({
      store,
      provider,
      idleMs: 15 * 60 * 1000,
      closeBrowser: async () => "down",
    });
    expect(released.stopped).toEqual([id]);
    expect(provider.calls.stop).toBe(1);
    expect((await store.read(id))?.activeTaskCount).toBe(0);
    expect((await store.read(id))?.state).toBe("OFF");
    expect(await prisma.computerPowerUse.count({ where: { organizationId: id } })).toBe(1);
  });
});
