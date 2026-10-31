import { createHmac, timingSafeEqual } from "node:crypto";

export type PhoneOwner = { id: string; whatsappPhoneNumberId: string | null };

export type InboundText = {
  phoneNumberId: string;
  from: string;
  messageId: string;
  body: string;
  name: string | null;
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyWebhookChallenge(input: {
  mode: string | null;
  verifyToken: string | null;
  challenge: string | null;
  expectedToken: string | null;
}) {
  if (!input.expectedToken) return { ok: false as const, status: 503 as const };
  if (
    input.mode === "subscribe" &&
    input.challenge &&
    input.verifyToken &&
    safeEqual(input.verifyToken, input.expectedToken)
  ) {
    return { ok: true as const, challenge: input.challenge };
  }
  return { ok: false as const, status: 403 as const };
}

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!appSecret || !header) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(header.trim(), expected);
}

export function parseInboundTexts(payload: unknown): InboundText[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const found: InboundText[] = [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: unknown }).value as
        | {
            metadata?: { phone_number_id?: unknown };
            messages?: unknown;
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
          }
        | undefined;
      if (!value) continue;
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of messages) {
        const row = message as {
          id?: unknown;
          from?: unknown;
          type?: unknown;
          text?: { body?: unknown };
        };
        if (row.type !== "text") continue;
        const body = typeof row.text?.body === "string" ? row.text.body.trim() : "";
        const from = String(row.from ?? "").replace(/\D/g, "");
        const messageId = String(row.id ?? "");
        if (!body || !from || !messageId) continue;
        const contact = value.contacts?.find((item) => item.wa_id === from || item.wa_id === String(row.from ?? ""));
        found.push({
          phoneNumberId,
          from,
          messageId,
          body: body.slice(0, 2000),
          name: contact?.profile?.name?.trim() || null,
        });
      }
    }
  }
  return found;
}

export function routeInbound(message: InboundText, owners: PhoneOwner[]) {
  const owner = owners.find((item) => item.whatsappPhoneNumberId === message.phoneNumberId);
  if (!owner) return null;
  return { organizationId: owner.id, message };
}
