import { handleMercadoPagoWebhook } from "@/lib/mercadopago/webhook";
import { logEvent } from "@/lib/log";
import { consumeRateLimit } from "@/lib/rate-limit";
import { captureException } from "@/lib/sentry";

export const dynamic = "force-dynamic";

const LIMIT = 60;
const WINDOW_MS = 60_000;

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return ip.slice(0, 80);
}

/**
 * Igual que POST /api/flow/confirmacion: Mercado Pago no manda la cookie de sesión
 * ni el token CSRF. La autenticación es la firma x-signature. El límite es por IP.
 */
export async function POST(request: Request) {
  try {
    if (!consumeRateLimit(`mercadopago:${clientIp(request)}`, LIMIT, WINDOW_MS).ok) {
      logEvent("mercadopago.webhook", { status: 429, reason: "ritmo" });
      return Response.json({ ok: false }, { status: 429 });
    }
    const signal = await handleMercadoPagoWebhook(request);
    logEvent("mercadopago.webhook", { status: signal.httpStatus, repeated: signal.repeated, ok: signal.ok });
    if (!signal.ok) return Response.json({ ok: false }, { status: signal.httpStatus });
    return Response.json({ ok: true, repetido: signal.repeated });
  } catch (error) {
    captureException(error, { source: "mercadopago.webhook" });
    logEvent("mercadopago.webhook", { status: 500, reason: "excepcion" });
    return Response.json({ ok: false }, { status: 500 });
  }
}
