import { sealChatText } from "@/lib/chat/secrets";
import { wantsPortalAccess, wantsVaultSave } from "@/lib/chat/sensitive";
import { clientAskedForLogin, explicitVaultAsk } from "@/lib/credentials/policy";

export type ModelTurn = { role: "user" | "assistant"; text: string };

export function shouldAttachVaultNote(latestUserText: string) {
  const clean = latestUserText.trim();
  if (!clean) return false;
  if (wantsVaultSave(clean) || wantsPortalAccess(clean)) return false;
  return explicitVaultAsk(clean) || clientAskedForLogin(clean);
}

export function lastUserText(messages: readonly ModelTurn[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.text;
  }
  return "";
}

/** La nota de bóveda no se agrega como mensaje del cliente ni contamina otro tema. */
export function prepareModelTurn(history: readonly ModelTurn[], vaultNote: string) {
  const messages = history.map((message) =>
    message.role === "user" ? { ...message, text: sealChatText(message.text) } : message,
  );
  const attach = shouldAttachVaultNote(lastUserText(messages));
  return { messages, vaultNote: attach ? vaultNote.trim() : "" };
}
