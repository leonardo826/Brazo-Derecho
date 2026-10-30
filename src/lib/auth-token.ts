import { createHash, randomBytes } from "node:crypto";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

export function createAuthTokenValue() {
  return randomBytes(32).toString("base64url");
}

export function hashAuthToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
