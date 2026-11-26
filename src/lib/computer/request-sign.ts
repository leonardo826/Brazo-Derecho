import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNATURE_WINDOW_SECONDS = 60;

export function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

export function bodyHash(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalRequest(input: { timestamp: string; nonce: string; method: string; path: string; body: string; host: string }) {
  return [input.timestamp, input.nonce, input.method.toUpperCase(), input.path, bodyHash(input.body), normalizeHost(input.host)].join("\n");
}

export function signRequest(input: { token: string; method: string; path: string; body?: string; host: string; timestamp?: string; nonce?: string }) {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomBytes(16).toString("base64url");
  const body = input.body ?? "";
  const host = normalizeHost(input.host);
  const signature = createHmac("sha256", input.token)
    .update(canonicalRequest({ timestamp, nonce, method: input.method, path: input.path, body, host }))
    .digest("base64url");
  return {
    "x-iabot-timestamp": timestamp,
    "x-iabot-nonce": nonce,
    "x-iabot-host": host,
    "x-iabot-signature": signature,
  };
}

export function signaturesMatch(expected: string, got: string) {
  if (!expected || !got || expected === got && expected.length < 20) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(got);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
