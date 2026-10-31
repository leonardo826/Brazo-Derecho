export const CSRF_COOKIE = "bd_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function validCsrfToken(value: string) {
  return /^[a-f0-9]{32}$/.test(value);
}

export function sameOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function tokensMatch(left: string, right: string) {
  if (!validCsrfToken(left) || !validCsrfToken(right)) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
