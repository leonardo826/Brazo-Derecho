import type { AgentId } from "@/lib/catalog";
import type { SubStatus } from "@/lib/flow/state";

export type PaymentProviderId = "flow" | "mercadopago";

export type StartSubscriptionInput = {
  organizationId: string;
  agent: AgentId;
  payerEmail: string;
  amountClp: number;
};

export type CancelSubscriptionInput = {
  organizationId: string;
  agent: AgentId;
};

/** Resultado de un aviso, sin el cuerpo crudo del proveedor. */
export type NormalizedPaymentSignal = {
  provider: PaymentProviderId;
  ok: boolean;
  httpStatus: number;
  repeated: boolean;
  subscriptionStatus: SubStatus | null;
};

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  isConfigured(): boolean;
  startSubscription(input: StartSubscriptionInput): Promise<{ redirectUrl: string }>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<boolean>;
  handleWebhook(request: Request): Promise<NormalizedPaymentSignal>;
}
