import { flowPaymentProvider } from "@/lib/payments/flow";
import { mercadoPagoPaymentProvider } from "@/lib/payments/mercadopago";
import type { PaymentProvider, PaymentProviderId } from "@/lib/payments/types";

const providers: Record<PaymentProviderId, PaymentProvider> = {
  flow: flowPaymentProvider,
  mercadopago: mercadoPagoPaymentProvider,
};

export function getPaymentProvider(id: PaymentProviderId): PaymentProvider {
  return providers[id];
}

export function listPaymentProviders(): PaymentProvider[] {
  return [providers.flow, providers.mercadopago];
}
