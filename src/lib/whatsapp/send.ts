import { whatsappEnv } from "@/lib/env";

export function whatsappTextPayload(to: string, body: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  };
}

export async function sendWhatsappText(phoneNumberId: string, to: string, body: string, fetchImpl: typeof fetch = fetch) {
  const { token } = whatsappEnv();
  if (!token || !phoneNumberId || !to || !body.trim()) return { sent: false as const, reason: "sin-configuracion" as const };
  const response = await fetchImpl(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(whatsappTextPayload(to, body)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { sent: false as const, reason: "error" as const };
  return { sent: true as const };
}
