import { randomBytes } from "node:crypto";
import { machineAgentKind, type MachineAgentKind } from "@/lib/computer/agent-kind";
import { computerEnabledForOrg } from "@/lib/computer/flag";
import { COMPUTER_WARMING_MESSAGE } from "@/lib/computer/power-copy";
import { isIpAddress, isPrivateAddress } from "@/lib/computer/private-address";
import { signRequest } from "@/lib/computer/request-sign";
import { callMachine } from "@/lib/computer/transport";

const TRIP = /\b(vuelos?|pasajes?|viajes?|trayectos?)\b/i;
const DELEGATE = /\b(computador|navegador|sitio web|p[aá]gina web)\b/i;
const TAX_PORTAL = /\b(sii|previred|tesorer[ií]a|servicio de impuestos internos)\b/i;
const MONTHS =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const HAS_DATE = new RegExp(
  `\\b\\d{1,2}\\s+de\\s+(?:${MONTHS})\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b|\\b(?:hoy|mañana|pasado mañana)\\b`,
  "i",
);
const HAS_DIRECTION = /\b(solo ida|s[oó]lo ida|ida y vuelta|ida)\b/i;
const IRREVERSIBLE =
  /\b(compra|comprar|c[oó]mpralo|paga|pagar|reserva y paga|emite|emitir|env[ií]a|enviar|declara|declarar|presenta|presentar)\b/i;

const ABSENT = "No hay un computador para esta empresa. No entré a ningún sitio y no hay resultado.";
const TRANSPORT =
  "El computador de esta empresa no es alcanzable desde la app. No hay red autenticada hasta esa máquina. No entré a ningún sitio y no hay resultado.";
const NOT_REAL = "El computador no entregó una fuente pública verificada. No hay resultado.";
const CANCELLED = "Detuviste la tarea. No hay resultado.";
const TIMEOUT = "El computador no respondió a tiempo. No hay resultado.";
const FAILED = "No pude completar la tarea en el computador de esta empresa. No hay resultado.";
const LIMITE = "Llegaste al tope de tareas de hoy. No llamé al computador.";

type Slot = "when" | "trip";
type Pending = { key: string; goal: string; missing: Slot[] };

let pending: Pending | null = null;

export type ComputerLease = {
  organizationId: string;
  machineId: string;
  baseUrl: string;
  pin: string;
  epoch: number;
  token: string;
};

export type LeaseState =
  | { state: "ausente" }
  | { state: "transporte" }
  | { state: "detenido" }
  | { state: "listo"; lease: ComputerLease };

export type DesktopLog = {
  organizationId: string;
  outcome: string;
  ms: number;
  called: boolean;
};

export type ReadyGate =
  | { ok: true }
  | { ok: false; message: string; reason?: string };

type Step = { kind?: unknown; action?: { type?: unknown; url?: unknown } };
type AgentPayload = { status?: unknown; result?: unknown; xaiMode?: unknown; steps?: unknown };

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function question(missing: Slot[]) {
  if (missing.includes("when") && missing.includes("trip")) return "¿Qué fecha y es solo ida o ida y vuelta?";
  if (missing.includes("when")) return "¿Qué fecha?";
  return "¿Es solo ida o ida y vuelta?";
}

function filled(slot: Slot, text: string) {
  return slot === "when" ? HAS_DATE.test(text) : HAS_DIRECTION.test(text);
}

function isNewTopic(text: string) {
  return !TRIP.test(text) && !DELEGATE.test(text) && !HAS_DATE.test(text) && !HAS_DIRECTION.test(text);
}

export function resetDesktopIntent() {
  pending = null;
}

export function planDesktopTask(text: string, key = "") {
  const value = clean(text);
  const own = pending && pending.key === key ? pending : null;
  if (own && !isNewTopic(value) && own.missing.some((slot) => filled(slot, value))) {
    const goal = `${own.goal} ${value}`.replace(/\s+/g, " ").slice(0, 2000);
    const missing = own.missing.filter((slot) => !filled(slot, value) && !filled(slot, goal));
    if (IRREVERSIBLE.test(goal)) {
      pending = null;
      return { kind: "confirm" as const };
    }
    if (missing.length === 0) {
      pending = null;
      return { kind: "run" as const, goal };
    }
    pending = { key, goal, missing };
    return { kind: "ask" as const, text: question(missing) };
  }
  if (own && isNewTopic(value)) pending = null;
  if (!value || (TAX_PORTAL.test(value) && !TRIP.test(value))) return { kind: "chat" as const };
  if (IRREVERSIBLE.test(value) && (TRIP.test(value) || DELEGATE.test(value))) return { kind: "confirm" as const };
  if (TRIP.test(value)) {
    const missing = [HAS_DATE.test(value) ? null : "when", HAS_DIRECTION.test(value) ? null : "trip"].filter(
      (slot): slot is Slot => slot !== null,
    );
    if (missing.length > 0) {
      if (key) pending = { key, goal: value.slice(0, 2000), missing };
      return { kind: "ask" as const, text: question(missing) };
    }
    return { kind: "run" as const, goal: value.slice(0, 2000) };
  }
  if (DELEGATE.test(value)) return { kind: "run" as const, goal: value.slice(0, 2000) };
  return { kind: "chat" as const };
}

function loopback(url: URL) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

export function usableLease(lease: ComputerLease | null, organizationId: string) {
  if (!lease || lease.organizationId !== organizationId) return null;
  if (!lease.token.trim() || !lease.machineId.trim() || lease.machineId.length > 80) return null;
  if (!isIpAddress(lease.pin) || isPrivateAddress(lease.pin)) return null;
  let url: URL;
  try {
    url = new URL(lease.baseUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
  if (host === "127.0.0.1" || host === "::1") return null;
  if (loopback(url) || url.protocol !== "https:") return null;
  return { ...lease, token: lease.token.trim(), machineId: lease.machineId.trim(), baseUrl: url.origin };
}

function redactResult(text: string, secret = "") {
  const hidden = secret ? text.split(secret).join("[redactado]") : text;
  return hidden
    .replace(/\b(clave|contraseña|password|secret|token|cookie)\b\s*[:=]\s*\S+/gi, "$1: [redactado]")
    .slice(0, 2000);
}

async function readLease(load: (organizationId: string) => Promise<LeaseState>, organizationId: string): Promise<LeaseState> {
  try {
    return await load(organizationId);
  } catch {
    return { state: "transporte" };
  }
}

async function openPower(input: {
  organizationId: string;
  signal?: AbortSignal;
  ensureReady?: (organizationId: string) => Promise<ReadyGate>;
}): Promise<ReadyGate> {
  if (input.ensureReady) return input.ensureReady(input.organizationId);
  const { ensureComputerReady } = await import("@/lib/computer/power");
  return ensureComputerReady(input.organizationId, { signal: input.signal });
}

async function holdTask(input: { organizationId: string; beginTask?: (organizationId: string) => Promise<boolean> }) {
  if (input.beginTask) return input.beginTask(input.organizationId);
  const { beginComputerTask } = await import("@/lib/computer/power");
  return beginComputerTask(input.organizationId);
}

async function releaseTask(input: { organizationId: string; endTask?: (organizationId: string) => Promise<void> }) {
  if (input.endTask) return input.endTask(input.organizationId);
  const { endComputerTask } = await import("@/lib/computer/power");
  await endComputerTask(input.organizationId);
}

function publicSource(data: AgentPayload) {
  const steps = Array.isArray(data.steps) ? (data.steps as Step[]) : [];
  const urls = steps
    .filter((step) => step.kind === "action" && step.action?.type === "goto" && typeof step.action.url === "string")
    .map((step) => String(step.action?.url));
  const source = urls.find((url) => {
    try {
      const parsed = new URL(url);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.hostname.endsWith(".internal") && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
    } catch {
      return false;
    }
  });
  if (!source || data.status !== "DONE" || data.xaiMode !== "live") return null;
  if (typeof data.result !== "string" || !data.result.includes(new URL(source).hostname)) return null;
  return source;
}

export async function executeDesktopRequest(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  agentKind: MachineAgentKind;
  text: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  loadLease: (organizationId: string) => Promise<LeaseState>;
  reserve?: () => Promise<{ ok: boolean; reservationId?: string | null }>;
  release?: (reservationId: string) => Promise<void>;
  ensureReady?: (organizationId: string) => Promise<ReadyGate>;
  beginTask?: (organizationId: string) => Promise<boolean>;
  endTask?: (organizationId: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  log?: (fields: DesktopLog) => void;
}): Promise<{ kind: "chat" } | { kind: "confirm" } | { kind: "reply"; text: string }> {
  if (!computerEnabledForOrg(input.organizationId)) return { kind: "chat" };
  const started = performance.now();
  const key = `${input.userId}\n${input.organizationId}\n${input.conversationId}`;
  const plan = planDesktopTask(input.text, key);
  let reservationId: string | null = null;
  const finish = async (outcome: string, called: boolean, text?: string) => {
    if (reservationId && outcome !== "real") await input.release?.(reservationId);
    input.log?.({
      organizationId: input.organizationId,
      outcome,
      ms: Math.round(performance.now() - started),
      called,
    });
    if (plan.kind === "chat" && outcome === "chat") return { kind: "chat" as const };
    if (plan.kind === "confirm" && outcome === "confirm") return { kind: "confirm" as const };
    return { kind: "reply" as const, text: text ?? ABSENT };
  };
  if (plan.kind === "chat") return finish("chat", false);
  if (plan.kind === "ask") return finish("ask", false, plan.text);
  if (plan.kind === "confirm") return finish("confirm", false);
  if (!machineAgentKind(input.agentKind)) return finish("datos", false, FAILED);
  if (input.signal?.aborted) return finish("cancel", false, CANCELLED);

  const looked = await readLease(input.loadLease, input.organizationId);
  if (looked.state === "ausente") return finish("ausente", false, ABSENT);
  const lease = looked.state === "listo" ? usableLease(looked.lease, input.organizationId) : null;
  if (!lease) return finish(looked.state === "detenido" ? "detenido" : "transporte", false, TRANSPORT);
  const again = await readLease(input.loadLease, input.organizationId);
  if (again.state !== "listo" || again.lease.epoch !== lease.epoch || again.lease.machineId !== lease.machineId) {
    return finish("revocado", false, TRANSPORT);
  }

  let powered: ReadyGate;
  try {
    powered = await openPower(input);
  } catch {
    return finish("transporte", false, TRANSPORT);
  }
  if (!powered.ok) {
    if (powered.reason === "ausente") return finish("ausente", false, ABSENT);
    if (powered.reason === "detenido" || powered.reason === "transporte") return finish(powered.reason, false, TRANSPORT);
    if (powered.reason === "cancelado") return finish("cancel", false, CANCELLED);
    return finish("encendiendo", false, powered.message || COMPUTER_WARMING_MESSAGE);
  }

  const slot = await input.reserve?.();
  if (!slot?.ok) return finish("limite", false, LIMITE);
  reservationId = slot.reservationId ?? null;
  let taskOpen = false;

  const goal = plan.goal.split(lease.token).join("[redactado]");
  const taskId = `t_${randomBytes(9).toString("hex")}`;
  const host = new URL(lease.baseUrl).hostname;
  const signed = (path: string, body: string) => ({
    "content-type": "application/json",
    ...signRequest({ token: lease.token, method: "POST", path, body, host }),
  });
  const taskAbort = new AbortController();
  let winner: "response" | "cancel" | "timeout" | null = null;
  let cancelSent = false;
  const sendCancel = () => {
    if (cancelSent) return;
    cancelSent = true;
    const body = JSON.stringify({ machineId: lease.machineId, taskId, epoch: lease.epoch });
    void callMachine({
      origin: lease.baseUrl,
      pin: lease.pin,
      path: "/task/cancel",
      method: "POST",
      headers: signed("/task/cancel", body),
      body,
      fetchImpl: input.fetchImpl,
      signal: AbortSignal.timeout(3_000),
    }).catch(() => undefined);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (kind: "cancel" | "timeout") => {
    if (winner) return;
    winner = kind;
    if (timer) clearTimeout(timer);
    taskAbort.abort();
    sendCancel();
  };
  const onUserAbort = () => stop("cancel");
  input.signal?.addEventListener("abort", onUserAbort, { once: true });
  const stopped = () => finish(winner === "timeout" ? "timeout" : "cancel", cancelSent, winner === "timeout" ? TIMEOUT : CANCELLED);
  try {
    if (input.signal?.aborted) return stopped();
    const fresh = await readLease(input.loadLease, input.organizationId);
    if (winner) return stopped();
    if (fresh.state !== "listo" || fresh.lease.epoch !== lease.epoch || fresh.lease.machineId !== lease.machineId) {
      return finish("revocado", false, TRANSPORT);
    }
    taskOpen = await holdTask(input);
    if (!taskOpen) return finish("encendiendo", false, COMPUTER_WARMING_MESSAGE);
    timer = setTimeout(() => stop("timeout"), input.timeoutMs ?? 20_000);
    const taskBody = JSON.stringify({
      goal,
      machineId: lease.machineId,
      taskId,
      epoch: lease.epoch,
      agentKind: input.agentKind,
    });
    const response = await callMachine({
      origin: lease.baseUrl,
      pin: lease.pin,
      path: "/task",
      method: "POST",
      headers: signed("/task", taskBody),
      body: taskBody,
      fetchImpl: input.fetchImpl,
      signal: taskAbort.signal,
    });
    if (winner) return stopped();
    winner = "response";
    clearTimeout(timer);
    if (response.status >= 300 && response.status < 400) return finish("fallo", true, FAILED);
    let data: AgentPayload | null = null;
    try {
      data = JSON.parse(response.body || "null") as AgentPayload;
    } catch {
      data = null;
    }
    const after = await readLease(input.loadLease, input.organizationId);
    if (after.state !== "listo" || after.lease.epoch !== lease.epoch || after.lease.machineId !== lease.machineId) {
      sendCancel();
      return finish("revocado", true, TRANSPORT);
    }
    const source = data ? publicSource(data) : null;
    const ok = response.status >= 200 && response.status < 300;
    if (!ok || !source || !data || typeof data.result !== "string") {
      return finish(ok ? "no-real" : "fallo", true, NOT_REAL);
    }
    reservationId = null;
    return finish("real", true, redactResult(data.result, lease.token));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const aborted = name === "AbortError" || name === "TimeoutError" || taskAbort.signal.aborted || input.signal?.aborted === true;
    if (aborted) {
      if (!winner) stop(input.signal?.aborted ? "cancel" : "timeout");
      return stopped();
    }
    sendCancel();
    return finish("fallo", true, FAILED);
  } finally {
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener("abort", onUserAbort);
    if (taskOpen) await releaseTask(input);
  }
}

export const DESKTOP_COPY = { ABSENT, TRANSPORT, NOT_REAL, CANCELLED, TIMEOUT, FAILED, LIMITE, WARMING: COMPUTER_WARMING_MESSAGE };
