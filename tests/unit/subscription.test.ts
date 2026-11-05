import { describe, expect, test } from "vitest";
import { formatClp } from "@/lib/format";
import { buildPreapprovalPayload } from "@/lib/mercadopago/checkout";
import { IABOT_PRICE_CLP, iabotChargeClp, iabotPriceClp, trialEnd, TRIAL_DAYS } from "@/lib/subscription";

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

  test("el precio de vitrina es 63546 bruto, con IVA incluido", () => {
    const previous = process.env.IABOT_PRICE_CLP;
    delete process.env.IABOT_PRICE_CLP;
    expect(IABOT_PRICE_CLP).toBe(63546);
    expect(formatClp(IABOT_PRICE_CLP)).toBe("$63.546");
    expect(iabotPriceClp()).toBe(63546);
    expect(iabotPriceClp("")).toBe(63546);
    expect(iabotPriceClp("  ")).toBe(63546);
    expect(iabotPriceClp("53400")).toBe(63546);
    expect(iabotChargeClp("53400")).toBe(63546);
    expect(iabotPriceClp("0")).toBeNull();
    expect(iabotPriceClp("44.990")).toBeNull();
    expect(iabotPriceClp("pronto")).toBeNull();
    expect(iabotChargeClp("pronto")).toBe(63546);
    expect(iabotPriceClp("44990")).toBe(44990);
    process.env.IABOT_PRICE_CLP = "63546";
    expect(iabotPriceClp()).toBe(63546);
    const payload = buildPreapprovalPayload({
      subscriptionId: "sub_iabot",
      payerEmail: "ana@ejemplo.cl",
      reason: "IA Bot Profesional",
      amountClp: iabotChargeClp(),
      firstChargeAt: trialEnd(),
    });
    expect(payload.auto_recurring.transaction_amount).toBe(63546);
    if (previous === undefined) delete process.env.IABOT_PRICE_CLP;
    else process.env.IABOT_PRICE_CLP = previous;
  });
});
