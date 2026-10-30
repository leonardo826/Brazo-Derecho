import { describe, expect, test, vi } from "vitest";
import { PLAN_LIMIT_MESSAGE } from "@/lib/plan-copy";
import { callWithinPlan } from "@/lib/plan-limit";

describe("cupo antes de xAI", () => {
  test("no llama al modelo si el plan del mes ya se llenó", async () => {
    const call = vi.fn(async () => "no debía llamarse");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [{ agent: "WHATSAPP", metric: "RESPONSES", quantity: 1 }],
      loadUsed: async () => 1000,
      call,
    });
    expect(result).toEqual({ ok: false, reason: "limite", message: PLAN_LIMIT_MESSAGE });
    expect(call).not.toHaveBeenCalled();
  });

  test("si falta cupo en cualquiera de las métricas, no llama", async () => {
    const call = vi.fn(async () => "no");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [
        { agent: "MARKETING", metric: "TEXTS", quantity: 1 },
        { agent: "MARKETING", metric: "IMAGES", quantity: 1 },
      ],
      loadUsed: async (_organizationId, metric) => (metric === "IMAGES" ? 30 : 1),
      call,
    });
    expect(result.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  test("con cupo, la llamada sí ocurre", async () => {
    const call = vi.fn(async () => "listo");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [{ agent: "QUOTES", metric: "QUOTES", quantity: 1 }],
      loadUsed: async () => 10,
      call,
    });
    expect(result).toEqual({ ok: true, value: "listo" });
    expect(call).toHaveBeenCalledOnce();
  });
});
