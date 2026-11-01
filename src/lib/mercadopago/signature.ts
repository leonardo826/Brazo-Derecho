import { createHmac, timingSafeEqual } from "node:crypto";

/** Cinco minutos. Un ts más viejo o más adelantado se rechaza. */
export const MERCADOPAGO_TS_TOLERANCE_MS = 5 * 60 * 1000;

export function normalizeMercadoPagoDataId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase();
}

/**
 * Manifiesto del webhook de Mercado Pago:
 * id:{data.id};request-id:{x-request-id};ts:{ts};
 * https://www.mercadopago.com/developers/es/docs/your-integrations/notifications/webhooks
 */
export function mercadoPagoManifest(dataId: string, requestId: string, ts: string) {
  return `id:${normalizeMercadoPagoDataId(dataId)};request-id:${requestId};ts:${ts};`;
}

export function signMercadoPagoManifest(manifest: string, secret: string) {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function signaturesMatch(provided: string, expected: string) {
  const left = Buffer.from(provided.toLowerCase());
  const right = Buffer.from(expected.toLowerCase());
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseSignatureHeader(header: string) {
  let ts = "";
  let v1 = "";
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  return { ts, v1 };
}

function timestampMillis(ts: string) {
  if (!/^\d{10,13}$/.test(ts)) return null;
  const value = Number(ts);
  if (!Number.isFinite(value)) return null;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function verifyMercadoPagoSignature(
  input: {
    xSignature: string | null;
    xRequestId: string | null;
    dataId: string | null;
    secret: string;
  },
  now = Date.now(),
  toleranceMs = MERCADOPAGO_TS_TOLERANCE_MS,
) {
  const secret = input.secret.trim();
  const dataId = normalizeMercadoPagoDataId(input.dataId ?? "");
  const requestId = (input.xRequestId ?? "").trim();
  if (!secret || !dataId || !requestId || !input.xSignature?.trim()) {
    return { ok: false as const, status: 401 as const, reason: "firma" as const };
  }
  const { ts, v1 } = parseSignatureHeader(input.xSignature);
  if (!ts || !v1) return { ok: false as const, status: 401 as const, reason: "firma" as const };
  const tsMs = timestampMillis(ts);
  if (tsMs == null || Math.abs(now - tsMs) > toleranceMs) {
    return { ok: false as const, status: 401 as const, reason: "ts" as const };
  }
  const expected = signMercadoPagoManifest(mercadoPagoManifest(dataId, requestId, ts), secret);
  if (!signaturesMatch(v1, expected)) {
    return { ok: false as const, status: 401 as const, reason: "firma" as const };
  }
  return { ok: true as const, dataId, ts };
}
