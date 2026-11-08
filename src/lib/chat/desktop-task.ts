const FLIGHT =
  /\b(vuelos?|pasajes?|aerol[ií]neas?|latam|jetsmart|sky airline|concepci[oó]n\s+a\s+santiago|santiago\s+a\s+concepci[oó]n)\b/i;
const USE_COMPUTER = /\b(tu computador|el computador|desde el navegador|abre el navegador|usa el navegador)\b/i;
const TAX_PORTAL = /\b(sii|previred|tesorer[ií]a|servicio de impuestos internos)\b/i;
const MONTHS =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";
const HAS_DATE = new RegExp(
  `\\b\\d{1,2}\\s+de\\s+(?:${MONTHS})\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b|\\b(?:hoy|mañana|pasado mañana)\\b`,
  "i",
);
const HAS_DIRECTION = /\b(solo ida|s[oó]lo ida|ida y vuelta|ida)\b/i;
const IRREVERSIBLE =
  /\b(compra|comprar|c[oó]mpralo|paga|pagar|reserva y paga|emite el pasaje|emitir el pasaje|env[ií]a|enviar|declara|declarar|presenta el f29|presentar el f29)\b/i;

const ABSENT = "No hay un computador en marcha para esta empresa. No entré a ningún sitio y no hay tarifa.";
const NOT_REAL = "El computador no entregó una ejecución real. No hay tarifa ni fuente verificada.";
const CANCELLED = "Detuviste la tarea. No hay resultado.";
const TIMEOUT = "El computador no respondió a tiempo. No hay tarifa.";
const FAILED = "No pude completar la tarea en el computador de esta empresa. No hay tarifa.";

export type TenantComputer = {
  clientId: string;
  status: "PENDING" | "PROVISIONING" | "RUNNING" | "STOPPED" | "NEEDS_QR" | "ERROR";
  flyApp: string;
  machineId: string;
};

export type DesktopPlan =
  | { kind: "chat" }
  | { kind: "ask"; text: string }
  | { kind: "confirm" }
  | { kind: "run"; goal: string };

export type DesktopLog = {
  organizationId: string;
  outcome: string;
  ms: number;
  called: boolean;
};

type AgentPayload = {
  status?: unknown;
  result?: unknown;
  xaiMode?: unknown;
  steps?: unknown;
};

export function planDesktopTask(text: string): DesktopPlan {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { kind: "chat" };
  if (IRREVERSIBLE.test(clean) && (FLIGHT.test(clean) || USE_COMPUTER.test(clean))) return { kind: "confirm" };
  const flight = FLIGHT.test(clean);
  const computer = USE_COMPUTER.test(clean) && !TAX_PORTAL.test(clean);
  if (!flight && !computer) return { kind: "chat" };
  if (TAX_PORTAL.test(clean) && !flight) return { kind: "chat" };
  const date = HAS_DATE.test(clean);
  const direction = HAS_DIRECTION.test(clean);
  if (flight && (!date || !direction)) {
    if (!date && !direction) return { kind: "ask", text: "¿Qué fecha y es solo ida o ida y vuelta?" };
    if (!date) return { kind: "ask", text: "¿Qué fecha?" };
    return { kind: "ask", text: "¿Es solo ida o ida y vuelta?" };
  }
  return { kind: "run", goal: clean.slice(0, 2000) };
}

export function tenantAgentUrl(computer: TenantComputer | null, organizationId: string) {
  if (!computer || computer.clientId !== organizationId) return null;
  if (computer.status !== "RUNNING") return null;
  const app = computer.flyApp.trim();
  const machine = computer.machineId.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9])$/.test(app)) return null;
  if (!machine || machine.length > 80) return null;
  return `http://${app}.internal:8787`;
}

function redactResult(text: string) {
  return text
    .replace(/\b(clave|contraseña|password|secret|token)\b\s*[:=]\s*\S+/gi, "$1: [redactado]")
    .slice(0, 2000);
}

function attested(data: AgentPayload) {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return (
    data.status === "DONE" &&
    data.xaiMode === "live" &&
    steps.length > 0 &&
    typeof data.result === "string" &&
    data.result.trim().length > 0
  );
}

export async function executeDesktopRequest(input: {
  organizationId: string;
  text: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  loadComputer: (organizationId: string) => Promise<TenantComputer | null>;
  fetchImpl?: typeof fetch;
  log?: (fields: DesktopLog) => void;
}): Promise<{ kind: "chat" } | { kind: "confirm" } | { kind: "reply"; text: string }> {
  const started = performance.now();
  const plan = planDesktopTask(input.text);
  const finish = (outcome: string, called: boolean, text?: string) => {
    input.log?.({
      organizationId: input.organizationId,
      outcome,
      ms: Math.round(performance.now() - started),
      called,
    });
    if (plan.kind === "chat") return { kind: "chat" as const };
    if (plan.kind === "confirm" && outcome === "confirm") return { kind: "confirm" as const };
    return { kind: "reply" as const, text: text ?? ABSENT };
  };
  if (plan.kind === "chat") return finish("chat", false);
  if (plan.kind === "ask") return finish("ask", false, plan.text);
  if (plan.kind === "confirm") return finish("confirm", false);
  if (input.signal?.aborted) return finish("cancel", false, CANCELLED);

  const computer = await input.loadComputer(input.organizationId);
  const url = tenantAgentUrl(computer, input.organizationId);
  if (!url) return finish("ausente", false, ABSENT);

  const timeout = AbortSignal.timeout(input.timeoutMs ?? 20_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  try {
    const response = await (input.fetchImpl ?? fetch)(`${url}/task`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: plan.goal }),
      signal,
    });
    const data = (await response.json().catch(() => null)) as AgentPayload | null;
    if (!response.ok || !data || !attested(data)) return finish(response.ok ? "no-real" : "fallo", true, NOT_REAL);
    return finish("real", true, redactResult(String(data.result)));
  } catch (error) {
    if (input.signal?.aborted) return finish("cancel", true, CANCELLED);
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError") return finish("timeout", true, TIMEOUT);
    return finish("fallo", true, FAILED);
  }
}

export const DESKTOP_COPY = { ABSENT, NOT_REAL, CANCELLED, TIMEOUT, FAILED };
