import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

export function canonicalRequest(input: { timestamp: string; nonce: string; method: string; path: string; body: string; host: string }) {
  const hash = createHash("sha256").update(input.body).digest("hex");
  return [input.timestamp, input.nonce, input.method.toUpperCase(), input.path, hash, normalizeHost(input.host)].join("\n");
}

export function requestSignature(token: string, input: { timestamp: string; nonce: string; method: string; path: string; body: string; host: string }) {
  return createHmac("sha256", token).update(canonicalRequest(input)).digest("base64url");
}

export function handshakeProof(token: string, nonce: string, machineId: string, host: string) {
  return createHmac("sha256", token).update(`${nonce}\n${machineId}\n${normalizeHost(host)}`).digest("base64url");
}

export function signaturesMatch(expected: string, got: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(got);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
