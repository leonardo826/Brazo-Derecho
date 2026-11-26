import type { IncomingHttpHeaders } from "node:http";
import type { AgentRequest } from "./http.ts";

export function readAgentHttp(method: string, path: string, raw: Buffer, headers: IncomingHttpHeaders): AgentRequest {
  const rawBody = raw.toString("utf8");
  let body: unknown;
  if (raw.length) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
  }
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  return { method, path, body, rawBody, headers: flat };
}
