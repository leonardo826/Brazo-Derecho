import { wantsPortalAccess, wantsVaultSave } from "@/lib/chat/sensitive";

const ASSIGNED =
  /\b(clave|contrase(?:ñ|n)a|password|passwd)\b(\s*(?:es|sea|:|=)\s*)([^\s,.;]{4,80})/gi;
const RUT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;

/** Quita secretos pegados en el chat antes de guardarlos o mandarlos al modelo. */
export function redactChatSecrets(text: string) {
  const credentialTurn = wantsVaultSave(text) || wantsPortalAccess(text);
  let out = text.replace(ASSIGNED, (_match, label: string, sep: string) => `${label}${sep}[redactado]`);
  if (credentialTurn) out = out.replace(RUT, "[redactado]");
  return out;
}
