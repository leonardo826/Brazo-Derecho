import type { ComputerLease, LeaseState } from "@/lib/chat/desktop-task";
import { computerEnabledForOrg } from "@/lib/computer/flag";
import { loadTenantLease } from "@/lib/computer/lease";
import { COMPUTER_WARMING_MESSAGE } from "@/lib/computer/power-copy";
import { memoryPowerStore, prismaPowerStore, type PowerStore } from "@/lib/computer/power-store";
import { defaultComputerProvider, type ComputerProvider, type MachineRef } from "@/lib/computer/provider";
import { postReadyHandshake } from "@/lib/computer/ready-handshake";
import { signRequest } from "@/lib/computer/request-sign";
import { callMachine } from "@/lib/computer/transport";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_INTERVAL_MS = 1_000;
const REAP_LIMIT = 20;
const REAP_PARALLEL = 4;
const STUCK_TASK_MS = 30 * 60 * 1000;

async function mapLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      await run(item);
    }
  });
  await Promise.all(workers);
}

export { COMPUTER_WARMING_MESSAGE };
export { memoryPowerStore };

export type ReadyResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      reason: "apagado" | "ausente" | "detenido" | "transporte" | "tiempo" | "cancelado";
    };

type PowerEnv = {
  COMPUTER_IDLE_MINUTES?: string;
  COMPUTER_READY_TIMEOUT_MS?: string;
  NODE_ENV?: string;
};

export function computerIdleMs(env: PowerEnv = process.env) {
  const minutes = Number(env.COMPUTER_IDLE_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0) return 15 * 60 * 1000;
  return minutes * 60 * 1000;
}

export function computerReadyTimeoutMs(env: PowerEnv = process.env) {
  const ms = Number(env.COMPUTER_READY_TIMEOUT_MS);
  if (!Number.isFinite(ms) || ms < 1_000) return DEFAULT_TIMEOUT_MS;
  return Math.min(ms, 240_000);
}

function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function originsMatch(endpoint: string, lease: string) {
  try {
    return new URL(endpoint).origin === new URL(lease).origin;
  } catch {
    return false;
  }
}

export type EnsureDeps = {
  now?: () => number;
  timeoutMs?: number;
  intervalMs?: number;
  store?: PowerStore;
  provider?: ComputerProvider;
  loadLease?: (organizationId: string) => Promise<LeaseState>;
  handshake?: (lease: ComputerLease) => Promise<boolean>;
  enabled?: boolean;
  signal?: AbortSignal;
};

async function awaitReady(input: {
  organizationId: string;
  lease: ComputerLease;
  store: PowerStore;
  provider: ComputerProvider;
  handshake: (lease: ComputerLease) => Promise<boolean>;
  now: () => number;
  deadline: number;
  intervalMs: number;
  timeoutMs: number;
  generation: number | undefined;
  signal?: AbortSignal;
  ref: MachineRef;
}): Promise<"ready" | "cancelado" | "tiempo" | "error"> {
  let generation = input.generation;
  while (input.now() < input.deadline) {
    if (input.signal?.aborted) {
      if (generation !== undefined) await input.store.markError(input.organizationId, generation, "cancelado", input.now());
      return "cancelado";
    }
    const row = await input.store.read(input.organizationId);
    if (!row) return "error";
    if (row.state === "READY") return "ready";
    if (row.state === "ERROR" || row.state === "OFF") return "error";
    if (row.state === "STOPPING") {
      await sleep(Math.min(input.intervalMs, input.deadline - input.now()), input.signal);
      continue;
    }
    if (generation !== undefined) {
      const held = await input.store.refreshClaim(input.organizationId, generation, input.now(), input.timeoutMs);
      if (!held) generation = undefined;
    }
    let running = false;
    try {
      const status = await input.provider.status(input.ref);
      if (status === "error") {
        if (generation !== undefined) await input.store.markError(input.organizationId, generation, "estado", input.now());
        return "error";
      }
      running = status === "running";
    } catch {
      running = false;
    }
    if (running) {
      const endpoint = await input.provider.getEndpoint(input.ref).catch(() => null);
      const same = !endpoint || originsMatch(endpoint.origin, input.lease.baseUrl);
      if (same) {
        const proved = await input.handshake(input.lease).catch(() => false);
        if (proved) {
          const marked = await input.store.markReady(input.organizationId, input.now(), {
            machineId: input.lease.machineId,
            epoch: input.lease.epoch,
          });
          if (marked) return "ready";
        }
      }
    }
    await sleep(Math.min(input.intervalMs, Math.max(0, input.deadline - input.now())), input.signal);
  }
  if (generation !== undefined) await input.store.markError(input.organizationId, generation, "tiempo", input.now());
  return "tiempo";
}

export async function ensureComputerReady(organizationId: string, options: EnsureDeps = {}): Promise<ReadyResult> {
  const enabled = options.enabled ?? computerEnabledForOrg(organizationId);
  if (!enabled) return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "apagado" };
  const now = options.now ?? Date.now;
  const store = options.store ?? prismaPowerStore();
  const provider = options.provider ?? defaultComputerProvider();
  const loadLease = options.loadLease ?? ((id: string) => loadTenantLease(id));
  const handshake = options.handshake ?? ((lease: ComputerLease) => postReadyHandshake(lease));
  const timeoutMs = options.timeoutMs ?? computerReadyTimeoutMs();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let looked: LeaseState;
  try {
    looked = await loadLease(organizationId);
  } catch {
    return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "transporte" };
  }
  if (looked.state === "ausente") return { ok: false, message: "", reason: "ausente" };
  if (looked.state === "detenido") return { ok: false, message: "", reason: "detenido" };
  if (looked.state !== "listo") return { ok: false, message: "", reason: "transporte" };
  const lease = looked.lease;
  const ref = { organizationId, machineId: lease.machineId };
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (options.signal?.aborted) return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "cancelado" };
    const claim = await store.claimStart(organizationId, now(), timeoutMs, {
      provider: provider.kind,
      machineId: lease.machineId,
      epoch: lease.epoch,
    });
    if (claim.role === "ready") {
      await store.touch(organizationId, now());
      return { ok: true };
    }
    if (claim.role === "stopping") {
      await sleep(Math.min(intervalMs, deadline - now()), options.signal);
      continue;
    }
    let generation: number | undefined;
    if (claim.role === "starter") {
      generation = claim.generation;
      const beat = setInterval(() => {
        void store.refreshClaim(organizationId, claim.generation, now(), timeoutMs);
      }, Math.max(50, Math.min(intervalMs, 1_000)));
      try {
        await store.notePowerOn(organizationId, now());
        await provider.start(ref);
      } catch {
        await store.markError(organizationId, claim.generation, "arranque", now());
        return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" };
      } finally {
        clearInterval(beat);
      }
    }
    const outcome = await awaitReady({
      organizationId,
      lease,
      store,
      provider,
      handshake,
      now,
      deadline,
      intervalMs,
      timeoutMs,
      generation,
      signal: options.signal,
      ref,
    });
    if (outcome === "ready") return { ok: true };
    if (outcome === "cancelado") return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "cancelado" };
    if (outcome === "tiempo") return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" };
    if (claim.role === "starter") return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" };
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())), options.signal);
  }
  return { ok: false, message: COMPUTER_WARMING_MESSAGE, reason: "tiempo" };
}

export async function beginComputerTask(organizationId: string, store: PowerStore = prismaPowerStore(), now = Date.now()) {
  return store.beginTask(organizationId, now);
}

export async function endComputerTask(organizationId: string, store: PowerStore = prismaPowerStore(), now = Date.now()) {
  await store.endTask(organizationId, now);
}

async function closeChromium(input: { organizationId: string; machineId: string }): Promise<"closed" | "busy" | "down"> {
  const looked = await loadTenantLease(input.organizationId).catch(() => ({ state: "transporte" as const }));
  if (looked.state !== "listo" || looked.lease.machineId !== input.machineId) return "down";
  const lease = looked.lease;
  const path = "/browser/close";
  const host = new URL(lease.baseUrl).hostname;
  const body = JSON.stringify({ machineId: lease.machineId, epoch: lease.epoch });
  try {
    const result = await callMachine({
      origin: lease.baseUrl,
      pin: lease.pin,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest({ token: lease.token, method: "POST", path, body, host }),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (result.status === 200) return "closed";
    let error = "";
    try {
      error = String((JSON.parse(result.body) as { error?: unknown }).error ?? "");
    } catch {
      error = "";
    }
    if (result.status === 409 && error === "tarea") return "busy";
    return "down";
  } catch {
    return "down";
  }
}

function orgMayIdle(organizationId: string, allow: ReadonlySet<string> | undefined) {
  return allow === undefined || allow.has(organizationId);
}

export async function reapIdleComputers(options: {
  now?: () => number;
  idleMs?: number;
  store?: PowerStore;
  provider?: ComputerProvider;
  allowOrganizationIds?: ReadonlySet<string>;
  closeBrowser?: (input: { organizationId: string; machineId: string }) => Promise<"closed" | "busy" | "down">;
} = {}) {
  const now = options.now ?? Date.now;
  const store = options.store ?? prismaPowerStore();
  const provider = options.provider ?? defaultComputerProvider();
  const closeBrowser = options.closeBrowser ?? closeChromium;
  const at = now();
  const idleBefore = at - (options.idleMs ?? computerIdleMs());
  const stuckBefore = at - STUCK_TASK_MS;
  const skippedBusy: string[] = [];
  const stopped: string[] = [];
  const allow = options.allowOrganizationIds;
  const busyRows = (await store.listBusy(idleBefore)).filter((row) => orgMayIdle(row.organizationId, allow));
  const stuck = busyRows.filter((row) => row.lastActivityAt < stuckBefore).slice(0, REAP_LIMIT);
  for (const row of busyRows) {
    if (row.lastActivityAt >= stuckBefore) skippedBusy.push(row.organizationId);
  }
  await mapLimit(stuck, REAP_PARALLEL, async (row) => {
    const closed = await closeBrowser({ organizationId: row.organizationId, machineId: row.machineId }).catch(() => "down" as const);
    if (closed === "busy") {
      skippedBusy.push(row.organizationId);
      return;
    }
    const cleared = await store.clearStuckTasks(row.organizationId, row.generation, row.lastActivityAt);
    if (!cleared) skippedBusy.push(row.organizationId);
  });
  const candidates = (await store.listStoppable(idleBefore, at))
    .filter((row) => orgMayIdle(row.organizationId, allow))
    .slice(0, REAP_LIMIT);
  await mapLimit(candidates, REAP_PARALLEL, async (row) => {
    const claim = await store.claimStop(row.organizationId, idleBefore, at);
    if (claim === "busy") {
      skippedBusy.push(row.organizationId);
      return;
    }
    if (claim !== "stop") return;
    const closed = await closeBrowser({ organizationId: row.organizationId, machineId: row.machineId }).catch(() => "down" as const);
    if (closed === "busy") {
      await store.abortStop(row.organizationId, now());
      skippedBusy.push(row.organizationId);
      return;
    }
    try {
      await provider.stop({ organizationId: row.organizationId, machineId: row.machineId });
    } catch {
      await store.failStop(row.organizationId, now());
      return;
    }
    const metered = await store.markOff(row.organizationId, now());
    if (metered) stopped.push(row.organizationId);
  });
  return { stopped, skippedBusy: [...new Set(skippedBusy)] };
}
