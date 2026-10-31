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
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new MercadoPagoApiError("Mercado Pago respondió en un formato que no pudimos leer", response.status);
    }
  }
  if (!response.ok) {
    throw new MercadoPagoApiError("Mercado Pago rechazó la llamada", response.status);
  }
  return data as T;
}
