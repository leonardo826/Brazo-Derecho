import { logEvent, type LogValue } from "@/lib/log";

export class MercadoPagoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MercadoPagoApiError";
  }
}

export function mercadoPagoAccessToken() {
  return process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
}

export function mercadoPagoWebhookSecret() {
  return process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? "";
}

export function mercadoPagoIsConfigured() {
  return mercadoPagoAccessToken().length > 0;
}

const SECRET_ENV_KEYS = ["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_PUBLIC_KEY"] as const;

function redactSecrets(value: string) {
  let out = value;
  for (const key of SECRET_ENV_KEYS) {
    const secret = process.env[key]?.trim() ?? "";
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:TEST|APP_USR)-[A-Za-z0-9._-]{6,}\b/g, "[redacted]");
}

function primitive(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function safeText(value: unknown, max: number) {
  const raw = primitive(value).slice(0, 4_000);
  if (!raw) return "";
  return redactSecrets(raw).slice(0, max);
}

function formatCauseItem(item: unknown) {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return safeText(item, 240);
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const row = item as Record<string, unknown>;
  const code = safeText(row.code, 40);
  const description = safeText(row.description, 240) || safeText(row.message, 240);
  const data = safeText(row.data, 120);
  const head = code && description ? `${code}: ${description}` : code || description;
  if (head && data) return `${head} data=${data}`;
  return head || (data ? `data=${data}` : "");
}

function formatCause(cause: unknown) {
  if (cause == null) return "";
  const items = Array.isArray(cause) ? cause : [cause];
  return items
    .slice(0, 8)
    .map(formatCauseItem)
    .filter(Boolean)
    .join(" | ")
    .slice(0, 800);
}

function mercadoPagoErrorFields(status: number, data: unknown): Record<string, LogValue> {
  const fields: Record<string, LogValue> = { status };
  if (typeof data === "string") {
    const message = safeText(data, 400);
    if (message) fields.message = message;
    return fields;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return fields;
  const record = data as Record<string, unknown>;
  const message = safeText(record.message, 400) || safeText(record.error, 400);
  const cause = formatCause(record.cause);
  if (message) fields.message = message;
  if (cause) fields.cause = cause;
  return fields;
}

export async function mercadoPagoCall<T>(
  path: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown },
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const accessToken = mercadoPagoAccessToken();
  if (!accessToken) throw new MercadoPagoApiError("Mercado Pago no está configurado", 503);
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await fetchImpl(`https://api.mercadopago.com${path}`, {
    method: init.method,
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data: unknown = {};
  let parsed = text.length === 0;
  if (text) {
    try {
      data = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }
  if (!response.ok) {
    logEvent("mercadopago.api", mercadoPagoErrorFields(response.status, parsed ? data : null));
    if (!parsed) {
      throw new MercadoPagoApiError("Mercado Pago respondió en un formato que no pudimos leer", response.status);
    }
    throw new MercadoPagoApiError("Mercado Pago rechazó la llamada", response.status);
  }
  if (!parsed) {
    throw new MercadoPagoApiError("Mercado Pago respondió en un formato que no pudimos leer", response.status);
  }
  return data as T;
}
