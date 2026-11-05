import { logEvent, type LogValue } from "@/lib/log";

const SECRET_FIELDS = new Set([
  "secret",
  "password",
  "clave",
  "ciphertext",
  "iv",
  "authTag",
  "username",
  "fillGrant",
  "grant",
  "token",
  "masterKey",
  "CREDENTIALS_MASTER_KEY",
]);

export function redactText(text: string, secrets: string[]) {
  const unique = [...new Set(secrets.filter((item) => item.length >= 4))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of unique) {
    out = out.split(secret).join("[redactado]");
  }
  return out;
}

export function logVault(event: string, fields: Record<string, LogValue>, secrets: string[] = []) {
  const master = process.env.CREDENTIALS_MASTER_KEY?.trim() ?? "";
  const hidden = master.length >= 4 ? [...secrets, master] : secrets;
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_FIELDS.has(key)) continue;
    safe[key] = typeof value === "string" ? redactText(value, hidden) : value;
  }
  logEvent(event, safe);
}
