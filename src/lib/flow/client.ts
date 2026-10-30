import { signFlowParams } from "@/lib/flow/sign";

export class FlowApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FlowApiError";
  }
}

export function flowConfig() {
  const apiKey = process.env.FLOW_API_KEY?.trim() ?? "";
  const secretKey = process.env.FLOW_SECRET_KEY?.trim() ?? "";
  const apiUrl = (process.env.FLOW_API_URL?.trim() || "https://sandbox.flow.cl/api").replace(/\/$/, "");
  if (!apiKey || !secretKey) return null;
  return { apiKey, secretKey, apiUrl };
}

export function flowIsConfigured() {
  return flowConfig() !== null;
}

export async function flowCall<T>(
  path: string,
  params: Record<string, string | number>,
  method: "GET" | "POST",
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const config = flowConfig();
  if (!config) throw new FlowApiError("Flow no está configurado", 503);
  const payload: Record<string, string> = { apiKey: config.apiKey };
  for (const [key, value] of Object.entries(params)) {
    if (key === "s" || key === "apiKey") continue;
    payload[key] = String(value);
  }
  const signed = { ...payload, s: signFlowParams(payload, config.secretKey) };
  const url = new URL(`${config.apiUrl}/${path.replace(/^\//, "")}`);
  let response: Response;
  if (method === "GET") {
    for (const [key, value] of Object.entries(signed)) url.searchParams.set(key, value);
    response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(20_000) });
  } else {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(signed),
      signal: AbortSignal.timeout(20_000),
    });
  }
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new FlowApiError("Flow respondió en un formato que no pudimos leer", response.status);
    }
  }
  if (!response.ok) {
    throw new FlowApiError("Flow rechazó la llamada", response.status);
  }
  return data as T;
}
