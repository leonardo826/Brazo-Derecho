import { createHmac, timingSafeEqual } from "node:crypto";

export function flowSignString(params: Record<string, string>) {
  return Object.keys(params)
    .filter((key) => key !== "s")
    .sort()
    .map((key) => key + params[key])
    .join("");
}

export function signFlowParams(params: Record<string, string>, secretKey: string) {
  return createHmac("sha256", secretKey).update(flowSignString(params)).digest("hex");
}

function signaturesMatch(left: string, right: string) {
  const a = Buffer.from(left.toLowerCase());
  const b = Buffer.from(right.toLowerCase());
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Flow firma con HMAC-SHA256: parámetros en orden alfabético, nombre pegado al
 * valor, sin separadores y sin el parámetro `s`.
 * https://developers.flow.cl/docs/intro
 *
 * El aviso a urlConfirmation, según el manual vigente, es un POST
 * application/x-www-form-urlencoded que trae solo `token`. Ese caso se acepta
 * y el estado se confirma con payment/getStatus, que sí va firmado.
 * Si el aviso trae `s`, tiene que coincidir. Cualquier otro campo sin una firma
 * válida se rechaza: no se cree un estado de pago que venga en el cuerpo.
 */
export function verifyFlowWebhook(params: Record<string, string>, secretKey: string) {
  const secret = secretKey.trim();
  if (!secret) return { ok: false as const, status: 401 as const, reason: "firma" as const };
  const token = (params.token ?? "").trim();
  if (!token || token.length > 200) return { ok: false as const, status: 400 as const, reason: "token" as const };
  const provided = (params.s ?? "").trim();
  const unsignedExtras = Object.keys(params).filter((key) => key !== "s" && key !== "token");
  if (!provided) {
    if (unsignedExtras.length > 0) return { ok: false as const, status: 401 as const, reason: "firma" as const };
    return { ok: true as const, token };
  }
  if (!signaturesMatch(provided, signFlowParams(params, secret))) {
    return { ok: false as const, status: 401 as const, reason: "firma" as const };
  }
  return { ok: true as const, token };
}
