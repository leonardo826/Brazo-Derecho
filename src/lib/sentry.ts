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

export async function captureException(
  error: unknown,
  fields: Record<string, LogValue> = {},
  fetchImpl: typeof fetch = fetch,
) {
  const message = (error instanceof Error ? error.message : "error").slice(0, 300);
  const name = error instanceof Error ? error.name : "Error";
  logEvent("exception", { name, message, ...fields });

  const dsn = process.env.SENTRY_DSN?.trim() ?? "";
  if (!dsn) return { sent: false as const };
  const target = parseSentryDsn(dsn);
  if (!target) return { sent: false as const };

  try {
    await fetchImpl(target.storeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "error",
        message: `${name}: ${message}`,
        platform: "node",
        extra: fields,
      }),
    });
  } catch {
    return { sent: false as const };
  }
  return { sent: true as const };
}
