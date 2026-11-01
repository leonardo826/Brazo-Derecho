import { cancelMercadoPagoSubscription, startMercadoPagoSubscription } from "@/lib/mercadopago/checkout";
import { mercadoPagoIsConfigured } from "@/lib/mercadopago/client";
import { handleMercadoPagoWebhook } from "@/lib/mercadopago/webhook";
import type { PaymentProvider } from "@/lib/payments/types";

export const mercadoPagoPaymentProvider: PaymentProvider = {
  id: "mercadopago",
  isConfigured: mercadoPagoIsConfigured,
  async startSubscription(input) {
    const redirectUrl = await startMercadoPagoSubscription(input);
    return { redirectUrl };
  },
  cancelSubscription(input) {
    return cancelMercadoPagoSubscription(input.organizationId, input.agent);
  },
  handleWebhook(request) {
    return handleMercadoPagoWebhook(request);
  },
};
