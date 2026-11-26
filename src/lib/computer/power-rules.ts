export const POWER_STATES = ["OFF", "STARTING", "READY", "STOPPING", "ERROR"] as const;

export type PowerState = (typeof POWER_STATES)[number];

export type PowerSnapshot = {
  id: string;
  organizationId: string;
  state: PowerState;
  generation: number;
  provider: string;
  machineId: string;
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

/** OFF, ERROR, o un STARTING cuyo dueño ya no responde. */
export function canClaimStart(row: ClaimView, now: number) {
  if (row.state === "OFF" || row.state === "ERROR") return true;
  return row.state === "STARTING" && (row.claimExpiresAt ?? 0) <= now;
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
