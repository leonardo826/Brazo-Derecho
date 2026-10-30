import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { flowCall } from "@/lib/flow/client";
import { agentForAmount, flowRedirectUrl, planFor, priceWithIva, trialDaysToAsk } from "@/lib/flow/plans";
import { signFlowParams } from "@/lib/flow/sign";
import { FLOW_PAYMENT, FLOW_SUBSCRIPTION, flowTargetFromPayment, nextSubscriptionState } from "@/lib/flow/state";
import { TRIAL_DAYS } from "@/lib/subscription";

const SECRET = "secret";
const KNOWN_STRING = "amount5000apiKeyXXXX-XXXX-XXXXcurrencyCLP";
const KNOWN_SIGNATURE = "fe613067477f15cff28b4fdd1116e23343c4fe995f9072f4d87014aba1ac7246";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FLOW_API_KEY;
  delete process.env.FLOW_SECRET_KEY;
  delete process.env.FLOW_API_URL;
});

describe("firma de Flow", () => {
  test("firma hmac sha256 con las claves ordenadas y sin separadores", () => {
    const signature = signFlowParams(
      { currency: "CLP", apiKey: "XXXX-XXXX-XXXX", amount: "5000" },
      SECRET,
    );
    expect(signature).toBe(KNOWN_SIGNATURE);
    expect(signFlowParams({ amount: "5000", apiKey: "XXXX-XXXX-XXXX", currency: "CLP" }, SECRET)).toBe(signature);
    expect(createHmac("sha256", SECRET).update(KNOWN_STRING).digest("hex")).toBe(signature);
  });

  test("el parámetro s no entra en la firma y un valor cambiado la rompe", () => {
    const params = { apiKey: "abc", token: "TOK" };
    const signature = signFlowParams(params, SECRET);
    expect(signFlowParams({ ...params, s: "basura" }, SECRET)).toBe(signature);
    expect(signFlowParams({ ...params, token: "OTRO" }, SECRET)).not.toBe(signature);
  });

  test("la llamada HTTP manda la firma y no el secreto", async () => {
    process.env.FLOW_API_KEY = "api-key";
    process.env.FLOW_SECRET_KEY = "super-secret";
    process.env.FLOW_API_URL = "https://sandbox.flow.cl/api";
    let sent = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await flowCall(
      "subscription/create",
      { planId: "brazo-whatsapp", customerId: "cus_1" },
      "POST",
      fetchMock as typeof fetch,
    );
    const params = new URLSearchParams(sent);
    expect(params.get("apiKey")).toBe("api-key");
    expect(params.get("planId")).toBe("brazo-whatsapp");
    expect(params.get("s")).toBe(
      signFlowParams({ apiKey: "api-key", planId: "brazo-whatsapp", customerId: "cus_1" }, "super-secret"),
    );
    expect(sent).not.toContain("super-secret");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://sandbox.flow.cl/api/subscription/create");
  });
});

describe("planes y prueba", () => {
  test("el monto con IVA queda en pesos enteros", () => {
    expect(priceWithIva(39990)).toBe(47588);
    expect(priceWithIva(49990)).toBe(59488);
    expect(priceWithIva(34990)).toBe(41638);
    expect(planFor("WHATSAPP").amountClp).toBe(47588);
    expect(agentForAmount(59488)).toBe("QUOTES");
    expect(agentForAmount(1)).toBeNull();
  });

  test("la prueba sigue siendo de 14 días la primera vez", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialDaysToAsk(null, new Date("2026-10-30T12:00:00.000Z"))).toBe(14);
    const now = new Date("2026-10-30T12:00:00.000Z");
    expect(
      trialDaysToAsk({ flowSubscriptionId: null, periodEnd: new Date(now.getTime() + 3 * 86_400_000) }, now),
    ).toBe(3);
    expect(trialDaysToAsk({ flowSubscriptionId: "sus_1", periodEnd: new Date(now.getTime() + 86_400_000) }, now)).toBe(0);
  });

  test("arma la url de la tarjeta aunque Flow mande un espacio", () => {
    expect(flowRedirectUrl(" https://sandbox.flow.cl/app/customer/disclaimer.php", "TOK EN")).toBe(
      "https://sandbox.flow.cl/app/customer/disclaimer.php?token=TOK%20EN",
    );
  });
});

describe("aviso de pago", () => {
  const now = new Date("2026-10-30T15:00:00.000Z");
  const trial = { status: "TRIAL" as const, periodEnd: new Date("2026-11-10T15:00:00.000Z") };

  test("un pago activa el agente por un mes", () => {
    const next = nextSubscriptionState(trial, { paymentStatus: FLOW_PAYMENT.PAID }, now);
    expect(next?.status).toBe("ACTIVE");
    expect(next && next.periodEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  test("un rechazo durante la prueba no corta los 14 días", () => {
    expect(nextSubscriptionState(trial, { paymentStatus: FLOW_PAYMENT.REJECTED }, now)).toBeNull();
  });

  test("un rechazo fuera de la prueba desactiva el agente", () => {
    const expiredTrial = { status: "TRIAL" as const, periodEnd: new Date("2026-10-01T00:00:00.000Z") };
    expect(nextSubscriptionState(expiredTrial, { paymentStatus: FLOW_PAYMENT.REJECTED }, now)?.status).toBe("EXPIRED");
    expect(nextSubscriptionState(trial, { morose: 1 }, now)).toBeNull();
    expect(nextSubscriptionState(expiredTrial, { morose: 1 }, now)?.status).toBe("EXPIRED");
  });

  test("la cancelación desactiva el agente", () => {
    expect(nextSubscriptionState(trial, { subscriptionStatus: FLOW_SUBSCRIPTION.CANCELED }, now)?.status).toBe("CANCELED");
    expect(nextSubscriptionState(trial, { paymentStatus: FLOW_PAYMENT.CANCELED }, now)?.status).toBe("CANCELED");
  });

  test("reconoce la empresa y el agente en el aviso", () => {
    const target = flowTargetFromPayment({
      status: "2",
      amount: 47588,
      payer: "Maria@LosAromos.cl",
      optional: JSON.stringify({ organizationId: "org_1", subscriptionId: "sus_abc" }),
    });
    expect(target.paymentStatus).toBe(2);
    expect(target.agent).toBe("WHATSAPP");
    expect(target.organizationId).toBe("org_1");
    expect(target.subscriptionId).toBe("sus_abc");
    expect(target.payer).toBe("maria@losaromos.cl");
  });
});
