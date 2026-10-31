import { randomBytes } from "node:crypto";
import { logEvent, type LogValue } from "@/lib/log";

export function parseSentryDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const key = decodeURIComponent(url.username);
    const project = url.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (!key || !project || !url.host) return null;
    return {
      storeUrl: `${url.protocol}//${url.host}/api/${project}/store/?sentry_key=${encodeURIComponent(key)}&sentry_version=7`,
    };
  } catch {
    return null;
  }
}

export function sentryEvent(error: unknown, fields: Record<string, LogValue> = {}) {
  const message = (error instanceof Error ? error.message : "error").slice(0, 300);
  const name = (error instanceof Error ? error.name : "Error").slice(0, 80) || "Error";
  return {
    event_id: randomBytes(16).toString("hex"),
    timestamp: new Date().toISOString(),
    platform: fields.source === "cliente" ? "javascript" : "node",
    level: "error",
    logger: "brazo-derecho",
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    exception: {
      values: [{ type: name, value: message }],
    },
    extra: fields,
  };
}

export async function captureException(
  error: unknown,
  fields: Record<string, LogValue> = {},
  fetchImpl: typeof fetch = fetch,
) {
  const event = sentryEvent(error, fields);
  const issue = event.exception.values[0];
  logEvent("exception", { name: issue?.type ?? "Error", message: issue?.value ?? "error", ...fields });

  const dsn = process.env.SENTRY_DSN?.trim() ?? "";
  if (!dsn) return { sent: false as const };
  const target = parseSentryDsn(dsn);
  if (!target) return { sent: false as const };

  try {
    const response = await fetchImpl(target.storeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) return { sent: false as const };
  } catch {
    return { sent: false as const };
  }
  return { sent: true as const };
}
