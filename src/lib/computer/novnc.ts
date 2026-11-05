import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function issueNovncToken(now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashNovncToken(token), expiresAt: new Date(now.getTime() + TEN_MINUTES_MS) };
}

export function hashNovncToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, hash: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(hash)) return false;
  const got = createHash("sha256").update(token).digest();
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(got, expected);
}

export function novncStillValid(expiresAt: Date | null | undefined, now = new Date()) {
  if (!expiresAt) return false;
  return expiresAt.getTime() > now.getTime();
}

export function safeNovncHref(raw: string) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function localNovncUrl(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.COMPUTER_LOCAL_NOVNC?.trim() ?? "";
  if (raw === "off") return "";
  if (raw) return safeNovncHref(raw);
  if (env.NODE_ENV === "production") return "";
  return "http://127.0.0.1:6080/vnc.html";
}
