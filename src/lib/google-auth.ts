import { appUrl } from "@/lib/env";

export const GOOGLE_STATE_COOKIE = "bd_google_state";

export function googleClient() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  return id && secret ? { id, secret } : null;
}

export function googleRedirectUri() {
  return `${appUrl()}/api/auth/google/callback`;
}
