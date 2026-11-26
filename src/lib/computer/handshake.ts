import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeHost } from "@/lib/computer/request-sign";

export function handshakeNonce() {
  return randomBytes(32).toString("base64url");
}

export function handshakeProof(token: string, nonce: string, machineId: string, host: string) {
  return createHmac("sha256", token).update(`${nonce}\n${machineId}\n${normalizeHost(host)}`).digest("base64url");
}

export function acceptHandshake(input: { token: string; nonce: string; machineId: string; host: string; body: unknown }) {
  if (!input.token || !input.nonce || !input.machineId || !input.host) return false;
  if (!input.body || typeof input.body !== "object") return false;
  const record = input.body as { machineId?: unknown; nonce?: unknown; host?: unknown; proof?: unknown };
  if (record.machineId !== input.machineId || record.nonce !== input.nonce) return false;
  if (typeof record.host !== "string" || normalizeHost(record.host) !== normalizeHost(input.host)) return false;
  if (typeof record.proof !== "string" || !record.proof || record.proof === input.token) return false;
  const expected = handshakeProof(input.token, input.nonce, input.machineId, input.host);
  const left = Buffer.from(expected);
  const right = Buffer.from(record.proof);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
