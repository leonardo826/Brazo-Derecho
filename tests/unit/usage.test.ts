import { describe, expect, test } from "vitest";
import { evaluateLimit, monthBounds, summarizeUsage } from "@/lib/usage";
import { USAGE_PRESETS, scaleUsage } from "@/lib/pricing";

describe("límites de uso", () => {
  test("deja pasar justo hasta el límite", () => {
    expect(evaluateLimit(999, 1, 1000)).toMatchObject({ ok: true, remaining: 0 });
  });

  test("corta cuando el pedido se pasa del límite", () => {
    const decision = evaluateLimit(1000, 1, 1000);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.remaining).toBe(0);
  });

  test("rechaza cantidades que no son enteros positivos", () => {
    expect(() => evaluateLimit(0, 0, 1000)).toThrow(/entero/);
    expect(() => evaluateLimit(0, 1.5, 1000)).toThrow(/entero/);
  });
});

describe("mes en Chile", () => {
  test("el período parte el día 1 y contiene la fecha", () => {
    const now = new Date("2026-01-15T15:00:00.000Z");
    const { start, end } = monthBounds(now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThan(now.getTime());
    const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", day: "numeric" }).format(start);
    const endDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", day: "numeric" }).format(end);
    expect(day).toBe("1");
    expect(endDay).toBe("1");
  });

  test("cruza el cambio de año en hora de Santiago", () => {
    const now = new Date("2026-01-01T02:30:00.000Z");
    const { start, end } = monthBounds(now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("resumen", () => {
  test("suma métricas y estima el costo de mil respuestas", () => {
    const tokens = scaleUsage(USAGE_PRESETS.whatsapp, 1000);
    const summary = summarizeUsage([
      {
        agent: "WHATSAPP",
        metric: "RESPONSES",
        quantity: 1000,
        ...tokens,
      },
    ]);
    expect(summary.totals.RESPONSES).toBe(1000);
    expect(summary.costClp).toBe(3681);
  });
});
