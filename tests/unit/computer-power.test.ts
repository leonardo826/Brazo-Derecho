import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { COMPUTER_WARMING_MESSAGE } from "@/lib/computer/power-copy";
import {
  beginComputerTask,
  computerIdleMs,
  endComputerTask,
  ensureComputerReady,
  memoryPowerStore,
  reapIdleComputers,
} from "@/lib/computer/power";
import { fakeProvider, staticProvider } from "@/lib/computer/provider";
import { handshakeProof } from "@/lib/computer/handshake";
import { postReadyHandshake, verifyReadyHandshake } from "@/lib/computer/ready-handshake";
import { idleCronResponse } from "@/lib/computer/idle-cron";
import { prewarmOrganization } from "@/lib/computer/prewarm";
import { resetRateLimits } from "@/lib/rate-limit";
import type { ComputerLease } from "@/lib/chat/desktop-task";

const ORG = "org-1";
const lease: ComputerLease = {
  organizationId: ORG,
  machineId: "maq-1",
  baseUrl: "https://vm.ejemplo.cl",
  pin: "93.184.216.34",
  epoch: 1,
  token: "lease-token-de-prueba",
};

const listo = async () => ({ state: "listo" as const, lease });

afterEach(() => {
  delete process.env.COMPUTER_FEATURE_ENABLED;
  delete process.env.COMPUTER_ENABLED_ORGS;
  resetRateLimits();
});

describe("proveedor", () => {
  test("el proveedor estático no apaga el VPS", async () => {
    const provider = staticProvider(async () => ({
      machineId: "maq-1",
      origin: "https://vm.ejemplo.cl",
      pin: "93.184.216.34",
    }));
    const ref = { organizationId: ORG, machineId: "maq-1" };
    expect(provider.kind).toBe("static");
    expect(await provider.create(ref)).toEqual({ machineId: "maq-1" });
    await provider.start(ref);
    await provider.stop(ref);
    await provider.delete(ref);
    expect(await provider.status(ref)).toBe("running");
    expect(await provider.getEndpoint(ref)).toEqual({ origin: "https://vm.ejemplo.cl", pin: "93.184.216.34" });
  });

  test("el falso cuenta cada llamada", async () => {
    const provider = fakeProvider();
    const ref = { organizationId: ORG, machineId: "maq-1" };
    await provider.create(ref);
    await provider.start(ref);
    expect(await provider.status(ref)).toBe("running");
    await provider.stop(ref);
    await provider.delete(ref);
    expect(provider.calls).toEqual({ create: 1, start: 1, stop: 1, delete: 1 });
    expect(await provider.getEndpoint(ref)).toBeNull();
  });
});

describe("estado del computador", () => {
  test("la migración guarda el estado y los segundos", () => {
    const sql = readFileSync("prisma/migrations/20261126153000_computer_power/migration.sql", "utf8");
    expect(sql).toContain("'OFF', 'STARTING', 'READY', 'STOPPING', 'ERROR'");
    expect(sql).toContain("ComputerPowerUse");
    expect(sql).toContain("activeTaskCount");
    expect(sql).toContain("generation");
  });

  test("OFF pasa a READY y un STOPPING no se roba mientras dura", async () => {
    const store = memoryPowerStore();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    const [first, second] = await Promise.all([
      store.claimStart(ORG, 0, 1_000, meta),
      store.claimStart(ORG, 0, 1_000, meta),
    ]);
    expect([first.role, second.role].sort()).toEqual(["starter", "waiter"]);
    await store.notePowerOn(ORG, 0);
    expect(await store.markReady(ORG, 10, { machineId: "maq-1", epoch: 1 })).toBe(true);
    expect((await store.read(ORG))?.state).toBe("READY");
    expect(await store.beginTask(ORG, 10)).toBe(true);
    expect(await store.claimStop(ORG, 11, 20)).toBe("busy");
    await store.endTask(ORG, 10);
    const [stop, again] = await Promise.all([store.claimStop(ORG, 11, 30), store.claimStop(ORG, 11, 30)]);
    expect([stop, again].filter((item) => item === "stop")).toHaveLength(1);
    const metered = await store.markOff(ORG, 5_000);
    expect(metered?.seconds).toBe(5);
    expect((await store.read(ORG))?.state).toBe("OFF");
    expect((await store.uses(ORG))[0]?.seconds).toBe(5);
    const retry = await store.claimStart(ORG, 6_000, 1_000, meta);
    expect(retry.role).toBe("starter");
    if (retry.role !== "starter") return;
    await store.markError(ORG, retry.generation, "tiempo", 6_000);
    expect((await store.read(ORG))?.state).toBe("ERROR");
    expect((await store.claimStart(ORG, 7_000, 1_000, meta)).role).toBe("starter");
  });

  test("un STARTING vencido se puede tomar y el dueño viejo ya no renueva", async () => {
    const store = memoryPowerStore();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    const claim = await store.claimStart(ORG, 0, 100, meta);
    expect(claim.role).toBe("starter");
    if (claim.role !== "starter") return;
    const stolen = await store.claimStart(ORG, 100, 100, meta);
    expect(stolen.role).toBe("starter");
    expect(await store.refreshClaim(ORG, claim.generation, 100, 100)).toBe(false);
  });

  test("un STOPPING vencido y un apagado fallido se pueden volver a tomar", async () => {
    const store = memoryPowerStore();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    expect((await store.claimStart(ORG, 0, 1_000, meta)).role).toBe("starter");
    expect(await store.markReady(ORG, 0, { machineId: "maq-1", epoch: 1 })).toBe(true);
    expect(await store.claimStop(ORG, 1, 0)).toBe("stop");
    const held = await store.claimStart(ORG, 1_000, 1_000, meta);
    expect(held.role).toBe("stopping");
    expect((await store.claimStart(ORG, 60_000, 1_000, meta)).role).toBe("starter");
    expect(await store.markReady("org-apagado", 0, { machineId: "maq-1", epoch: 1 })).toBe(false);
    expect((await store.claimStart("org-apagado", 0, 1_000, meta)).role).toBe("starter");
    expect(await store.markReady("org-apagado", 0, { machineId: "maq-1", epoch: 1 })).toBe(true);
    expect(await store.claimStop("org-apagado", 1, 0)).toBe("stop");
    await store.failStop("org-apagado", 0);
    const failed = await store.read("org-apagado");
    expect(failed?.state).toBe("ERROR");
    expect(failed?.errorCode).toBe("apagado");
    expect((await store.claimStart("org-apagado", 1, 1_000, meta)).role).toBe("starter");
  });

  test("READY de otra época o de otra máquina no está listo", async () => {
    const store = memoryPowerStore();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    expect((await store.claimStart(ORG, 0, 1_000, meta)).role).toBe("starter");
    expect(await store.markReady(ORG, 0, meta)).toBe(true);
    expect((await store.read(ORG))?.leaseEpoch).toBe(1);
    expect((await store.claimStart(ORG, 10, 1_000, { ...meta, epoch: 2 })).role).toBe("starter");
    expect(await store.markReady(ORG, 10, { machineId: "maq-1", epoch: 2 })).toBe(true);
    expect((await store.claimStart(ORG, 20, 1_000, { ...meta, machineId: "maq-2", epoch: 2 })).role).toBe("starter");
  });

  test("quince minutos es el silencio, salvo que se configure", () => {
    expect(computerIdleMs({})).toBe(15 * 60 * 1000);
    expect(computerIdleMs({ COMPUTER_IDLE_MINUTES: "5" })).toBe(5 * 60 * 1000);
  });
});

describe("ensureReady", () => {
  test("con el interruptor apagado no arranca", async () => {
    process.env.COMPUTER_FEATURE_ENABLED = "True";
    const provider = fakeProvider();
    const result = await ensureComputerReady(ORG, { provider, store: memoryPowerStore(), loadLease: listo });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("apagado");
    expect(provider.calls.start).toBe(0);
  });

  test("dos pedidos en paralelo arrancan una sola vez", async () => {
    const provider = fakeProvider();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    provider.start = async () => {
      starts += 1;
      await gate;
      provider.machineStatus = "running";
    };
    const store = memoryPowerStore();
    const options = {
      enabled: true,
      store,
      provider,
      timeoutMs: 2_000,
      intervalMs: 10,
      loadLease: listo,
      handshake: async () => true,
    };
    const pending = Promise.all([ensureComputerReady(ORG, options), ensureComputerReady(ORG, options)]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(starts).toBe(1);
    release();
    const [first, second] = await pending;
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(starts).toBe(1);
    expect((await store.read(ORG))?.state).toBe("READY");
  });

  test("si el apretón no llega, el aviso es el de la interfaz y no queda listo", async () => {
    const provider = fakeProvider();
    const store = memoryPowerStore();
    const result = await ensureComputerReady(ORG, {
      enabled: true,
      store,
      provider,
      timeoutMs: 40,
      intervalMs: 5,
      loadLease: listo,
      handshake: async () => false,
    });
    expect(result).toEqual({ ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" });
    expect(provider.calls.start).toBe(1);
    expect((await store.read(ORG))?.state).toBe("ERROR");
  });

  test("el proveedor estático llega a READY sin apagar nada", async () => {
    const provider = staticProvider(async () => ({
      machineId: "maq-1",
      origin: "https://vm.ejemplo.cl",
      pin: "93.184.216.34",
    }));
    const store = memoryPowerStore();
    const result = await ensureComputerReady(ORG, {
      enabled: true,
      store,
      provider,
      loadLease: listo,
      handshake: async () => true,
    });
    expect(result.ok).toBe(true);
    expect((await store.read(ORG))?.state).toBe("READY");
    expect(await provider.status({ organizationId: ORG, machineId: "maq-1" })).toBe("running");
  });
});

describe("apretón READY", () => {
  const now = 1_700_000_000;
  const nonce = "nonce-de-prueba-0001";
  const host = "vm.ejemplo.cl";

  function proofBody(status?: string) {
    return {
      machineId: lease.machineId,
      nonce,
      host,
      ...(status ? { status } : {}),
      proof: handshakeProof(lease.token, nonce, lease.machineId, host),
    };
  }

  test("acepta la firma buena, rechaza la mala, el status RUNNING y la repetición", () => {
    const consumed = new Map<string, number>();
    const good = {
      token: lease.token,
      nonce,
      timestamp: String(now),
      machineId: lease.machineId,
      host,
      body: proofBody("READY"),
      nowSeconds: now,
      consumed,
    };
    expect(verifyReadyHandshake(good)).toBe(true);
    expect(verifyReadyHandshake(good)).toBe(false);

    const stale = new Map<string, number>();
    expect(verifyReadyHandshake({ ...good, timestamp: String(now - 120), consumed: stale })).toBe(false);
    expect(stale.size).toBe(0);

    const bad = new Map<string, number>();
    expect(
      verifyReadyHandshake({
        ...good,
        consumed: bad,
        body: { ...proofBody("READY"), proof: `${handshakeProof(lease.token, nonce, lease.machineId, host)}x` },
      }),
    ).toBe(false);
    expect(verifyReadyHandshake({ ...good, consumed: bad })).toBe(true);

    const claimed = new Map<string, number>();
    expect(verifyReadyHandshake({ ...good, consumed: claimed, body: proofBody("RUNNING") })).toBe(false);
    expect(verifyReadyHandshake({ ...good, consumed: claimed, body: proofBody() })).toBe(true);
  });

  test("el request lleva nonce y timestamp nuevos y la prueba se comprueba", async () => {
    const consumed = new Map<string, number>();
    const seen: { nonce: string; timestamp: string }[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const timestamp = headers.get("x-iabot-timestamp") ?? "";
      const nonceHeader = headers.get("x-iabot-nonce") ?? "";
      const body = JSON.parse(String(init?.body)) as { nonce: string; machineId: string; host: string };
      seen.push({ nonce: nonceHeader, timestamp });
      expect(body.nonce).toBe(nonceHeader);
      expect(headers.get("x-iabot-signature")).toBeTruthy();
      expect(Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))).toBeLessThan(5);
      const proof = handshakeProof(lease.token, body.nonce, body.machineId, body.host);
      return new Response(JSON.stringify({ ...body, status: "READY", proof }), { status: 200 });
    }) as typeof fetch;
    expect(await postReadyHandshake(lease, { fetchImpl, consumed })).toBe(true);
    const again = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { nonce: string; machineId: string; host: string };
      expect(body.nonce).not.toBe(seen[0]?.nonce);
      return new Response(JSON.stringify({ ...body, proof: "firma-mala" }), { status: 200 });
    }) as typeof fetch;
    expect(await postReadyHandshake(lease, { fetchImpl: again, consumed })).toBe(false);
  });
});

describe("reaper", () => {
  test("no apaga si hay una tarea y, si no, cierra Chromium antes", async () => {
    let clock = 1_000;
    const store = memoryPowerStore();
    const provider = fakeProvider();
    const ready = await ensureComputerReady(ORG, {
      enabled: true,
      store,
      provider,
      now: () => clock,
      loadLease: listo,
      handshake: async () => true,
    });
    expect(ready.ok).toBe(true);
    expect(await beginComputerTask(ORG, store, clock)).toBe(true);
    const order: string[] = [];
    const busy = await reapIdleComputers({
      now: () => clock + 20 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => {
        order.push("close");
        return "closed";
      },
    });
    expect(busy.stopped).toEqual([]);
    expect(busy.skippedBusy).toContain(ORG);
    expect(provider.calls.stop).toBe(0);
    expect(order).toEqual([]);
    expect((await store.read(ORG))?.state).toBe("READY");

    await endComputerTask(ORG, store, clock);
    clock = 1_000 + 20 * 60 * 1000;
    const idle = await reapIdleComputers({
      now: () => clock,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => {
        order.push("close");
        return "closed";
      },
    });
    expect(order).toEqual(["close"]);
    expect(provider.calls.stop).toBe(1);
    expect(idle.stopped).toEqual([ORG]);
    expect((await store.read(ORG))?.state).toBe("OFF");
    expect((await store.uses(ORG))[0]?.seconds).toBe(20 * 60);
  });

  test("si el agente sigue en una tarea, no llama a stop", async () => {
    const store = memoryPowerStore();
    const provider = fakeProvider();
    await ensureComputerReady(ORG, {
      enabled: true,
      store,
      provider,
      now: () => 0,
      loadLease: listo,
      handshake: async () => true,
    });
    const result = await reapIdleComputers({
      now: () => 20 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => "busy",
    });
    expect(result.stopped).toEqual([]);
    expect(provider.calls.stop).toBe(0);
    expect((await store.read(ORG))?.state).toBe("READY");
  });

  test("un contador colgado más de 30 minutos se suelta y un 409 se respeta", async () => {
    const store = memoryPowerStore();
    const provider = fakeProvider();
    await ensureComputerReady(ORG, {
      enabled: true,
      store,
      provider,
      now: () => 0,
      loadLease: listo,
      handshake: async () => true,
    });
    expect(await beginComputerTask(ORG, store, 0)).toBe(true);
    const denied = await reapIdleComputers({
      now: () => 40 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => "busy",
    });
    expect(denied.stopped).toEqual([]);
    expect(provider.calls.stop).toBe(0);
    expect((await store.read(ORG))?.activeTaskCount).toBe(1);

    const released = await reapIdleComputers({
      now: () => 40 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => "down",
    });
    expect(released.stopped).toEqual([ORG]);
    expect((await store.read(ORG))?.activeTaskCount).toBe(0);
    expect((await store.read(ORG))?.state).toBe("OFF");
  });

  test("cada pasada apaga como máximo 20 máquinas", async () => {
    const store = memoryPowerStore();
    const provider = fakeProvider();
    const meta = { provider: "fake", machineId: "maq-1", epoch: 1 };
    for (let index = 0; index < 25; index += 1) {
      const id = `org-lote-${index}`;
      expect((await store.claimStart(id, 0, 1_000, meta)).role).toBe("starter");
      expect(await store.markReady(id, 0, meta)).toBe(true);
    }
    const result = await reapIdleComputers({
      now: () => 20 * 60 * 1000,
      idleMs: 15 * 60 * 1000,
      store,
      provider,
      closeBrowser: async () => "closed",
    });
    expect(result.stopped).toHaveLength(20);
    expect(provider.calls.stop).toBe(20);
  });
});

describe("precalentado y cron", () => {
  test("el precalentado se limita y no corre con el interruptor apagado", async () => {
    let calls = 0;
    const ensure = async () => {
      calls += 1;
      return { ok: true as const };
    };
    expect(await prewarmOrganization({ enabled: false, organizationId: ORG, ensure })).toEqual({ ok: true, skipped: true });
    expect(calls).toBe(0);
    for (let index = 0; index < 3; index += 1) {
      expect((await prewarmOrganization({ enabled: true, organizationId: ORG, ensure })).ok).toBe(true);
    }
    expect(calls).toBe(3);
    expect(await prewarmOrganization({ enabled: true, organizationId: ORG, ensure })).toEqual({ ok: true, limited: true });
    expect(calls).toBe(3);
    const warming = await prewarmOrganization({
      enabled: true,
      organizationId: "org-aviso",
      ensure: async () => ({ ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" }),
    });
    expect(warming).toEqual({ ok: false, message: COMPUTER_WARMING_MESSAGE });
    const stopped = await prewarmOrganization({
      enabled: true,
      organizationId: "org-detenido",
      ensure: async () => ({ ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "detenido" }),
    });
    const lost = await prewarmOrganization({
      enabled: true,
      organizationId: "org-transporte",
      ensure: async () => ({ ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "transporte" }),
    });
    expect(stopped).toEqual({ ok: true });
    expect(lost).toEqual({ ok: true });
  });

  test("el cron exige CRON_SECRET y no apaga si la función está apagada", async () => {
    const missing = await idleCronResponse(new Request("https://app.local/api/cron/computer-idle"));
    expect(missing.status).toBe(401);
    const wrong = await idleCronResponse(new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer otro" } }), {
      env: { CRON_SECRET: "secreto-cron" },
    });
    expect(wrong.status).toBe(401);
    let ran = 0;
    const off = await idleCronResponse(
      new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer secreto-cron" } }),
      {
        env: { CRON_SECRET: "secreto-cron" },
        reap: async () => {
          ran += 1;
          return { stopped: [], skippedBusy: [] };
        },
      },
    );
    expect(await off.json()).toEqual({ ok: true, stopped: 0, busy: 0 });
    expect(ran).toBe(0);
    const on = await idleCronResponse(
      new Request("https://app.local/api/cron/computer-idle", { headers: { authorization: "Bearer secreto-cron" } }),
      {
        env: { CRON_SECRET: "secreto-cron", COMPUTER_FEATURE_ENABLED: "true", COMPUTER_ENABLED_ORGS: "org-1,org-2" },
        reap: async () => {
          ran += 1;
          return { stopped: ["org-1"], skippedBusy: ["org-2"] };
        },
      },
    );
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ ok: true, stopped: 1, busy: 1 });
    expect(ran).toBe(1);
  });
});
