import { describe, expect, test } from "vitest";
import { buildPreapprovalPayload } from "@/lib/mercadopago/checkout";
import { iabotPriceClp, trialEnd, TRIAL_DAYS } from "@/lib/subscription";

describe("prueba de IA Bot", () => {
  test("TRIAL_DAYS es 7", () => {
    expect(TRIAL_DAYS).toBe(7);
  });

  test("trialEnd suma 7 días", () => {
    const now = new Date("2026-11-04T04:00:00.000Z");
    expect(trialEnd(now).toISOString()).toBe("2026-11-11T04:00:00.000Z");
  });

  test("Mercado Pago cobra al terminar la prueba: start_date = ahora + 7 días", () => {
    const now = new Date();
    const end = trialEnd(now);
    expect(end.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    const payload = buildPreapprovalPayload({
      subscriptionId: "sub_iabot",
      payerEmail: "ana@ejemplo.cl",
      reason: "IA Bot Profesional",
      amountClp: 1000,
      firstChargeAt: end,
    });
    expect(payload.auto_recurring.start_date).toBe(end.toISOString());
  });

  test("el precio solo aparece si IABOT_PRICE_CLP es un entero positivo", () => {
    const previous = process.env.IABOT_PRICE_CLP;
    delete process.env.IABOT_PRICE_CLP;
    expect(iabotPriceClp()).toBeNull();
    expect(iabotPriceClp("")).toBeNull();
    expect(iabotPriceClp("  ")).toBeNull();
    expect(iabotPriceClp("0")).toBeNull();
    expect(iabotPriceClp("44.990")).toBeNull();
    expect(iabotPriceClp("pronto")).toBeNull();
    expect(iabotPriceClp("44990")).toBe(44990);
    process.env.IABOT_PRICE_CLP = "39990";
    expect(iabotPriceClp()).toBe(39990);
    if (previous === undefined) delete process.env.IABOT_PRICE_CLP;
    else process.env.IABOT_PRICE_CLP = previous;
  });
});
