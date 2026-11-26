import { Prisma, prisma } from "@/lib/prisma";
import {
  canClaimStart,
  canClaimStop,
  isBusyIdle,
  type PowerSnapshot,
  type PowerState,
  type PowerUse,
} from "@/lib/computer/power-rules";

const STOP_HOLD_MS = 60_000;

export type StartClaim =
  | { role: "starter"; generation: number }
  | { role: "ready" }
  | { role: "waiter" }
  | { role: "stopping" };

export type PowerStore = {
  claimStart(
    organizationId: string,
    now: number,
    timeoutMs: number,
    meta: { provider: string; machineId: string },
  ): Promise<StartClaim>;
  notePowerOn(organizationId: string, now: number): Promise<void>;
  refreshClaim(organizationId: string, generation: number, now: number, timeoutMs: number): Promise<boolean>;
  markReady(organizationId: string, now: number): Promise<boolean>;
  markError(organizationId: string, generation: number, code: string, now: number): Promise<void>;
  read(organizationId: string): Promise<PowerSnapshot | null>;
  touch(organizationId: string, now: number): Promise<void>;
  beginTask(organizationId: string, now: number): Promise<boolean>;
  endTask(organizationId: string, now: number): Promise<void>;
  listBusy(idleBefore: number): Promise<PowerSnapshot[]>;
  listStoppable(idleBefore: number, now: number): Promise<PowerSnapshot[]>;
  claimStop(organizationId: string, idleBefore: number, now: number): Promise<"stop" | "busy" | "skip">;
  abortStop(organizationId: string, now: number): Promise<void>;
  failStop(organizationId: string, now: number): Promise<void>;
  markOff(organizationId: string, now: number): Promise<{ seconds: number } | null>;
  uses(organizationId: string): Promise<PowerUse[]>;
};

function blank(organizationId: string, now: number, meta: { provider: string; machineId: string }): PowerSnapshot {
  return {
    id: `mem_${organizationId}`,
    organizationId,
    state: "OFF",
    generation: 0,
    provider: meta.provider,
    machineId: meta.machineId,
    lastActivityAt: now,
    activeTaskCount: 0,
    powerOnAt: null,
    claimExpiresAt: null,
    errorCode: "",
  };
}

export function memoryPowerStore(): PowerStore {
  const rows = new Map<string, PowerSnapshot>();
  const uses: PowerUse[] = [];
  let tail: Promise<void> = Promise.resolve();

  const exclusive = <T>(body: () => T): Promise<T> => {
    const run = tail.then(body, body);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const rowOf = (organizationId: string) => rows.get(organizationId) ?? null;

  return {
    claimStart(organizationId, now, timeoutMs, meta) {
      return exclusive(() => {
        let row = rowOf(organizationId);
        if (!row) {
          row = blank(organizationId, now, meta);
          rows.set(organizationId, row);
        }
        if (row.state === "READY") return { role: "ready" as const };
        if (row.state === "STOPPING" && (row.claimExpiresAt ?? 0) > now) return { role: "stopping" as const };
        if (!canClaimStart(row, now)) return { role: "waiter" as const };
        row.state = "STARTING";
        row.generation += 1;
        row.provider = meta.provider;
        row.machineId = meta.machineId || row.machineId;
        row.claimExpiresAt = now + timeoutMs;
        row.errorCode = "";
        row.lastActivityAt = now;
        return { role: "starter" as const, generation: row.generation };
      });
    },
    notePowerOn(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (row && row.powerOnAt === null) row.powerOnAt = now;
      });
    },
    refreshClaim(organizationId, generation, now, timeoutMs) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "STARTING" || row.generation !== generation) return false;
        row.claimExpiresAt = now + timeoutMs;
        return true;
      });
    },
    markReady(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row) return false;
        if (row.state === "READY") {
          row.lastActivityAt = now;
          return true;
        }
        if (row.state !== "STARTING") return false;
        if (row.powerOnAt === null) row.powerOnAt = now;
        row.state = "READY";
        row.generation += 1;
        row.lastActivityAt = now;
        row.claimExpiresAt = null;
        row.errorCode = "";
        return true;
      });
    },
    markError(organizationId, generation, code, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "STARTING" || row.generation !== generation) return;
        row.state = "ERROR";
        row.generation += 1;
        row.errorCode = code;
        row.claimExpiresAt = null;
        row.lastActivityAt = now;
      });
    },
    read(organizationId) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        return row ? { ...row } : null;
      });
    },
    touch(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (row) row.lastActivityAt = now;
      });
    },
    beginTask(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "READY") return false;
        row.activeTaskCount += 1;
        row.lastActivityAt = now;
        return true;
      });
    },
    endTask(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row) return;
        if (row.activeTaskCount > 0) row.activeTaskCount -= 1;
        row.lastActivityAt = now;
      });
    },
    listBusy(idleBefore) {
      return exclusive(() => [...rows.values()].filter((row) => isBusyIdle(row, idleBefore)).map((row) => ({ ...row })));
    },
    listStoppable(idleBefore, now) {
      return exclusive(() =>
        [...rows.values()].filter((row) => canClaimStop(row, idleBefore, now)).map((row) => ({ ...row })),
      );
    },
    claimStop(organizationId, idleBefore, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row) return "skip" as const;
        if (row.activeTaskCount > 0 && isBusyIdle(row, idleBefore)) return "busy" as const;
        if (!canClaimStop(row, idleBefore, now)) return "skip" as const;
        row.state = "STOPPING";
        row.generation += 1;
        row.claimExpiresAt = now + STOP_HOLD_MS;
        return "stop" as const;
      });
    },
    abortStop(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "STOPPING") return;
        row.state = "READY";
        row.generation += 1;
        row.claimExpiresAt = null;
        row.lastActivityAt = now;
      });
    },
    failStop(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "STOPPING") return;
        row.claimExpiresAt = now;
        row.errorCode = "apagado";
      });
    },
    markOff(organizationId, now) {
      return exclusive(() => {
        const row = rowOf(organizationId);
        if (!row || row.state !== "STOPPING") return null;
        const started = row.powerOnAt;
        const seconds = started === null ? 0 : Math.max(0, Math.floor((now - started) / 1000));
        row.state = "OFF";
        row.generation += 1;
        row.powerOnAt = null;
        row.claimExpiresAt = null;
        row.errorCode = "";
        row.lastActivityAt = now;
        if (started === null) return { seconds: 0 };
        uses.push({
          organizationId,
          provider: row.provider,
          startedAt: started,
          endedAt: now,
          seconds,
        });
        return { seconds };
      });
    },
    uses(organizationId) {
      return exclusive(() => uses.filter((item) => item.organizationId === organizationId).map((item) => ({ ...item })));
    },
  };
}

function uniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

type PowerRow = {
  id: string;
  organizationId: string;
  state: PowerState;
  generation: number;
  provider: string;
  machineId: string;
  lastActivityAt: Date;
  activeTaskCount: number;
  powerOnAt: Date | null;
  claimExpiresAt: Date | null;
  errorCode: string;
};

function snapshot(row: PowerRow): PowerSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    state: row.state,
    generation: row.generation,
    provider: row.provider,
    machineId: row.machineId,
    lastActivityAt: row.lastActivityAt.getTime(),
    activeTaskCount: row.activeTaskCount,
    powerOnAt: row.powerOnAt?.getTime() ?? null,
    claimExpiresAt: row.claimExpiresAt?.getTime() ?? null,
    errorCode: row.errorCode,
  };
}

/**
 * El UPDATE … WHERE estado es el compare-and-swap. Postgres serializa la fila:
 * dos arranques no pueden ganar los dos. Misma condición que canClaimStart / canClaimStop.
 */
export function prismaPowerStore(client: typeof prisma = prisma): PowerStore {
  const readRow = async (organizationId: string) => {
    const row = await client.computerPower.findUnique({ where: { organizationId } });
    return row ? snapshot(row) : null;
  };

  return {
    async claimStart(organizationId, now, timeoutMs, meta) {
      const stamp = new Date(now);
      const expires = new Date(now + timeoutMs);
      try {
        const created = await client.computerPower.create({
          data: {
            organizationId,
            state: "STARTING",
            generation: 1,
            provider: meta.provider,
            machineId: meta.machineId,
            lastActivityAt: stamp,
            claimExpiresAt: expires,
          },
        });
        return { role: "starter", generation: created.generation };
      } catch (error) {
        if (!uniqueConflict(error)) throw error;
      }
      const claimed = await client.computerPower.updateMany({
        where: {
          organizationId,
          OR: [
            { state: { in: ["OFF", "ERROR"] } },
            { state: "STARTING", claimExpiresAt: { lte: stamp } },
          ],
        },
        data: {
          state: "STARTING",
          generation: { increment: 1 },
          provider: meta.provider,
          machineId: meta.machineId,
          lastActivityAt: stamp,
          claimExpiresAt: expires,
          errorCode: "",
        },
      });
      if (claimed.count === 1) {
        const row = await readRow(organizationId);
        return { role: "starter", generation: row?.generation ?? 0 };
      }
      const row = await readRow(organizationId);
      if (!row) return { role: "waiter" };
      if (row.state === "READY") return { role: "ready" };
      if (row.state === "STOPPING") return { role: "stopping" };
      return { role: "waiter" };
    },
    async notePowerOn(organizationId, now) {
      await client.computerPower.updateMany({
        where: { organizationId, powerOnAt: null },
        data: { powerOnAt: new Date(now) },
      });
    },
    async refreshClaim(organizationId, generation, now, timeoutMs) {
      const updated = await client.computerPower.updateMany({
        where: { organizationId, state: "STARTING", generation },
        data: { claimExpiresAt: new Date(now + timeoutMs) },
      });
      return updated.count === 1;
    },
    async markReady(organizationId, now) {
      const stamp = new Date(now);
      await client.computerPower.updateMany({
        where: { organizationId, state: "STARTING", powerOnAt: null },
        data: { powerOnAt: stamp },
      });
      const updated = await client.computerPower.updateMany({
        where: { organizationId, state: "STARTING" },
        data: {
          state: "READY",
          generation: { increment: 1 },
          lastActivityAt: stamp,
          claimExpiresAt: null,
          errorCode: "",
        },
      });
      if (updated.count === 1) return true;
      const touched = await client.computerPower.updateMany({
        where: { organizationId, state: "READY" },
        data: { lastActivityAt: stamp },
      });
      return touched.count === 1;
    },
    async markError(organizationId, generation, code, now) {
      await client.computerPower.updateMany({
        where: { organizationId, state: "STARTING", generation },
        data: {
          state: "ERROR",
          generation: { increment: 1 },
          errorCode: code,
          claimExpiresAt: null,
          lastActivityAt: new Date(now),
        },
      });
    },
    read: readRow,
    async touch(organizationId, now) {
      await client.computerPower.updateMany({
        where: { organizationId },
        data: { lastActivityAt: new Date(now) },
      });
    },
    async beginTask(organizationId, now) {
      const updated = await client.computerPower.updateMany({
        where: { organizationId, state: "READY" },
        data: { activeTaskCount: { increment: 1 }, lastActivityAt: new Date(now) },
      });
      return updated.count === 1;
    },
    async endTask(organizationId, now) {
      await client.computerPower.updateMany({
        where: { organizationId, activeTaskCount: { gt: 0 } },
        data: { activeTaskCount: { decrement: 1 }, lastActivityAt: new Date(now) },
      });
    },
    async listBusy(idleBefore) {
      const rows = await client.computerPower.findMany({
        where: {
          activeTaskCount: { gt: 0 },
          lastActivityAt: { lt: new Date(idleBefore) },
          state: { in: ["READY", "ERROR", "STARTING", "STOPPING"] },
        },
      });
      return rows.map(snapshot);
    },
    async listStoppable(idleBefore, now) {
      const rows = await client.computerPower.findMany({
        where: {
          activeTaskCount: 0,
          OR: [
            { state: { in: ["READY", "ERROR"] }, lastActivityAt: { lt: new Date(idleBefore) } },
            { state: "STOPPING", claimExpiresAt: { lte: new Date(now) } },
          ],
        },
      });
      return rows.map(snapshot);
    },
    async claimStop(organizationId, idleBefore, now) {
      const updated = await client.computerPower.updateMany({
        where: {
          organizationId,
          activeTaskCount: 0,
          OR: [
            { state: { in: ["READY", "ERROR"] }, lastActivityAt: { lt: new Date(idleBefore) } },
            { state: "STOPPING", claimExpiresAt: { lte: new Date(now) } },
          ],
        },
        data: {
          state: "STOPPING",
          generation: { increment: 1 },
          claimExpiresAt: new Date(now + STOP_HOLD_MS),
        },
      });
      if (updated.count === 1) return "stop";
      const row = await readRow(organizationId);
      if (row && isBusyIdle(row, idleBefore)) return "busy";
      return "skip";
    },
    async abortStop(organizationId, now) {
      await client.computerPower.updateMany({
        where: { organizationId, state: "STOPPING" },
        data: {
          state: "READY",
          generation: { increment: 1 },
          claimExpiresAt: null,
          lastActivityAt: new Date(now),
        },
      });
    },
    async failStop(organizationId, now) {
      await client.computerPower.updateMany({
        where: { organizationId, state: "STOPPING" },
        data: { claimExpiresAt: new Date(now), errorCode: "apagado" },
      });
    },
    async markOff(organizationId, now) {
      const stamp = new Date(now);
      return client.$transaction(async (tx) => {
        const row = await tx.computerPower.findUnique({ where: { organizationId } });
        if (!row || row.state !== "STOPPING") return null;
        const updated = await tx.computerPower.updateMany({
          where: { organizationId, state: "STOPPING", generation: row.generation },
          data: {
            state: "OFF",
            generation: { increment: 1 },
            powerOnAt: null,
            claimExpiresAt: null,
            errorCode: "",
            lastActivityAt: stamp,
          },
        });
        if (updated.count !== 1) return null;
        if (!row.powerOnAt) return { seconds: 0 };
        const seconds = Math.max(0, Math.floor((stamp.getTime() - row.powerOnAt.getTime()) / 1000));
        await tx.computerPowerUse.create({
          data: {
            organizationId,
            computerPowerId: row.id,
            provider: row.provider,
            startedAt: row.powerOnAt,
            endedAt: stamp,
            seconds,
          },
        });
        return { seconds };
      });
    },
    async uses(organizationId) {
      const rows = await client.computerPowerUse.findMany({
        where: { organizationId },
        orderBy: { startedAt: "asc" },
      });
      return rows.map((row) => ({
        organizationId: row.organizationId,
        provider: row.provider,
        startedAt: row.startedAt.getTime(),
        endedAt: row.endedAt.getTime(),
        seconds: row.seconds,
      }));
    },
  };
}
