export type CredentialMeta = {
  id: string;
  label: string;
  portal: string;
  usernameHint: string;
};

function clip(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

export function sanitizeCredentialMeta(input: unknown): CredentialMeta[] {
  if (!Array.isArray(input)) return [];
  const out: CredentialMeta[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = clip(row.id, 64);
    const label = clip(row.label, 80);
    const portal = clip(row.portal, 120);
    const usernameHint = clip(row.usernameHint, 32);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || !label || !portal) continue;
    out.push({ id, label, portal, usernameHint });
    if (out.length >= 20) break;
  }
  return out;
}

export function credentialPrompt(credentials: CredentialMeta[] | undefined) {
  if (!credentials?.length) {
    return "No hay credenciales para esta tarea. Si hay que entrar a un portal, indica abrir /panel/boveda. No inventes claves.";
  }
  const lines = credentials.map(
    (item) => `{id:${item.id}, label:${item.label}, portal:${item.portal}, usernameHint:${item.usernameHint}}`,
  );
  return `Credenciales, solo metadatos: ${lines.join(" | ")}`;
}
