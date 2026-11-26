import type { ComputerLease } from "@/lib/chat/desktop-task";
import { acceptHandshake, handshakeNonce } from "@/lib/computer/handshake";
import { SIGNATURE_WINDOW_SECONDS, signRequest } from "@/lib/computer/request-sign";
import { callMachine } from "@/lib/computer/transport";

const seenNonces = new Map<string, number>();

function sweep(consumed: Map<string, number>, now: number) {
  for (const [nonce, at] of consumed) {
    if (now - at > SIGNATURE_WINDOW_SECONDS * 2) consumed.delete(nonce);
  }
}

/**
 * El apretón listo es el mismo HMAC del arriendo: timestamp, nonce, método, ruta, cuerpo y host.
 * La prueba de la respuesta no cambia. Un status distinto de READY no cuenta. Si el agente
 * instalado no manda status, la prueba igual alcanza: no se copia un RUNNING que la máquina se atribuya.
 */
export function verifyReadyHandshake(input: {
  token: string;
  nonce: string;
  timestamp: string;
  machineId: string;
  host: string;
  body: unknown;
  nowSeconds?: number;
  consumed?: Map<string, number>;
}) {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const consumed = input.consumed ?? seenNonces;
  if (!/^[0-9]{10}$/.test(input.timestamp)) return false;
  if (Math.abs(now - Number(input.timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;
  if (!acceptHandshake({
    token: input.token,
    nonce: input.nonce,
    machineId: input.machineId,
    host: input.host,
    body: input.body,
  })) {
    return false;
  }
  const status = (input.body as { status?: unknown }).status;
  if (status !== undefined && status !== "READY") return false;
  sweep(consumed, now);
  if (consumed.has(input.nonce)) return false;
  consumed.set(input.nonce, now);
  return true;
}

export async function postReadyHandshake(
  lease: ComputerLease,
  options: {
    fetchImpl?: typeof fetch;
    nowSeconds?: number;
    consumed?: Map<string, number>;
    allowLoopback?: boolean;
  } = {},
) {
  const nonce = handshakeNonce();
  const timestamp = String(options.nowSeconds ?? Math.floor(Date.now() / 1000));
  const host = new URL(lease.baseUrl).hostname;
  const path = "/handshake";
  const body = JSON.stringify({ nonce, machineId: lease.machineId, host });
  let result: { status: number; body: string };
  try {
    result = await callMachine({
      origin: lease.baseUrl,
      pin: lease.pin,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest({ token: lease.token, method: "POST", path, body, host, timestamp, nonce }),
      },
      body,
      signal: AbortSignal.timeout(3_000),
      allowLoopback: options.allowLoopback,
      fetchImpl: options.fetchImpl,
    });
  } catch {
    return false;
  }
  if (result.status !== 200 || !result.body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body) as unknown;
  } catch {
    return false;
  }
  return verifyReadyHandshake({
    token: lease.token,
    nonce,
    timestamp,
    machineId: lease.machineId,
    host,
    body: parsed,
    nowSeconds: options.nowSeconds,
    consumed: options.consumed,
  });
}
