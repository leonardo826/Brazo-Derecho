import { deliverEmail, type OutboundEmail } from "@/lib/email/deliver";
import { logEvent } from "@/lib/log";
import { prisma } from "@/lib/prisma";

export async function sendEmail(message: OutboundEmail, fetchImpl: typeof fetch = fetch) {
  const delivery = await deliverEmail(message, fetchImpl);
  const keepBody = delivery.provider === "mock";
  try {
    await prisma.emailMessage.create({
      data: {
        to: message.to.slice(0, 160),
        subject: message.subject.slice(0, 200),
        text: keepBody ? message.text : "",
        html: keepBody ? message.html : "",
        kind: message.kind,
        provider: delivery.provider,
        status: delivery.status,
        error: delivery.error.slice(0, 300),
      },
    });
  } catch (error) {
    logEvent("email.store_error", {
      kind: message.kind,
      to: message.to,
      message: (error instanceof Error ? error.message : "error").slice(0, 200),
    });
  }
  return delivery;
}
