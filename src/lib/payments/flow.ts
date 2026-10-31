import { POST as flowWebhookPost } from "@/app/api/flow/confirmacion/route";
import { flowIsConfigured } from "@/lib/flow/client";
import { cancelFlowSubscription, startFlowSubscription } from "@/lib/flow/checkout";
import { prisma } from "@/lib/prisma";
import type { NormalizedPaymentSignal, PaymentProvider } from "@/lib/payments/types";

const emptySignal = {
  provider: "flow" as const,
  repeated: false,
  subscriptionStatus: null,
};

export const flowPaymentProvider: PaymentProvider = {
  id: "flow",
  isConfigured: flowIsConfigured,
  async startSubscription(input) {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
    const user = await prisma.user.findUnique({ where: { email: input.payerEmail } });
    const url = await startFlowSubscription({
      organizationId: input.organizationId,
      organizationName: organization.name,
      email: input.payerEmail,
      name: user?.name || organization.name,
      agent: input.agent,
    });
    if (url) {
      try {
        await prisma.subscription.updateMany({
          where: { organizationId: input.organizationId, agent: input.agent },
          data: { provider: "FLOW" },
        });
      } catch {
        // Flow ya armó el cobro. El medio queda en FLOW por el valor por defecto si este update falla.
      }
    }
    return { redirectUrl: url ?? "" };
  },
  cancelSubscription(input) {
    return cancelFlowSubscription(input.organizationId, input.agent);
  },
  async handleWebhook(request) {
    const response = await flowWebhookPost(request);
    let repeated = false;
    try {
      const body = (await response.clone().json()) as { repetido?: unknown };
      repeated = body.repetido === true;
    } catch {
      repeated = false;
    }
    const signal: NormalizedPaymentSignal = {
      ...emptySignal,
      ok: response.ok,
      httpStatus: response.status,
      repeated,
    };
    return signal;
  },
};
