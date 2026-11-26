export const POWER_STATES = ["OFF", "STARTING", "READY", "STOPPING", "ERROR"] as const;

export type PowerState = (typeof POWER_STATES)[number];

export type PowerSnapshot = {
  id: string;
  organizationId: string;
  state: PowerState;
  generation: number;
  provider: string;
  machineId: string;
  leaseEpoch: number;
  lastActivityAt: number;
  activeTaskCount: number;
  powerOnAt: number | null;
  claimExpiresAt: number | null;
  errorCode: string;
};

export type PowerUse = {
  organizationId: string;
  provider: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
};

type ClaimView = Pick<PowerSnapshot, "state" | "claimExpiresAt">;
type StopView = Pick<PowerSnapshot, "state" | "activeTaskCount" | "lastActivityAt" | "claimExpiresAt">;

/** OFF, ERROR, un STARTING vencido, o un STOPPING vencido. */
export function canClaimStart(row: ClaimView, now: number) {
  if (row.state === "OFF" || row.state === "ERROR") return true;
  if (row.state === "STARTING" || row.state === "STOPPING") return (row.claimExpiresAt ?? 0) <= now;
  return false;
}

/** Listo o en error, quieto, sin tareas. Un STOPPING vencido se puede reintentar. */
export function canClaimStop(row: StopView, idleBefore: number, now: number) {
  if (row.activeTaskCount !== 0) return false;
  if (row.state === "READY" || row.state === "ERROR") return row.lastActivityAt < idleBefore;
  if (row.state === "STOPPING") return (row.claimExpiresAt ?? 0) <= now;
  return false;
}

export function isBusyIdle(row: Pick<PowerSnapshot, "state" | "activeTaskCount" | "lastActivityAt">, idleBefore: number) {
  if (row.activeTaskCount <= 0 || row.lastActivityAt >= idleBefore) return false;
  return row.state === "READY" || row.state === "ERROR" || row.state === "STARTING" || row.state === "STOPPING";
}
