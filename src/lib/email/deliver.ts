import { logEvent } from "@/lib/log";

export type EmailKind = "verificacion" | "recuperacion";

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  kind: EmailKind;
};

export type EmailDelivery = {
  provider: "mock" | "resend";
  status: "simulado" | "enviado" | "fallido";
  error: string;
};

const RESEND_URL = "https://api.resend.com/emails";

export function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() ?? "";
}

export function emailFromAddress() {
  return process.env.RESEND_FROM?.trim() || "Brazo Derecho <onboarding@resend.dev>";
}

export function emailIsMock() {
  return resendApiKey() === "";
}

export async function deliverEmail(message: OutboundEmail, fetchImpl: typeof fetch = fetch): Promise<EmailDelivery> {
  const apiKey = resendApiKey();
  if (!apiKey) {
    logEvent("email.mock", {
      to: message.to,
      subject: message.subject,
      kind: message.kind,
      text: message.text,
    });
    return { provider: "mock", status: "simulado", error: "" };
  }

  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      logEvent("email.resend_error", { to: message.to, kind: message.kind, status: response.status });
      return { provider: "resend", status: "fallido", error: detail || `HTTP ${response.status}` };
    }
    logEvent("email.resend", { to: message.to, kind: message.kind, subject: message.subject });
    return { provider: "resend", status: "enviado", error: "" };
  } catch (error) {
    const detail = (error instanceof Error ? error.message : "error de red").slice(0, 300);
    logEvent("email.resend_error", { to: message.to, kind: message.kind, error: detail });
    return { provider: "resend", status: "fallido", error: detail };
  }
}
