import { describe, expect, test } from "vitest";
import { limitFor } from "@/lib/catalog";
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

  test("respeta el tope mensual de cada agente", () => {
    expect(evaluateLimit(limitFor("WHATSAPP", "RESPONSES"), 1, limitFor("WHATSAPP", "RESPONSES")).ok).toBe(false);
    expect(evaluateLimit(limitFor("QUOTES", "QUOTES"), 1, limitFor("QUOTES", "QUOTES")).ok).toBe(false);
    expect(evaluateLimit(limitFor("MARKETING", "TEXTS"), 1, limitFor("MARKETING", "TEXTS")).ok).toBe(false);
    expect(evaluateLimit(limitFor("MARKETING", "IMAGES"), 1, limitFor("MARKETING", "IMAGES")).ok).toBe(false);
    expect(limitFor("WHATSAPP", "RESPONSES")).toBe(1000);
    expect(limitFor("QUOTES", "QUOTES")).toBe(300);
    expect(limitFor("MARKETING", "TEXTS")).toBe(60);
    expect(limitFor("MARKETING", "IMAGES")).toBe(30);
  });

  test("los tokens quedan en el modelo de esa empresa y no se mezclan con otra", () => {
    const ferreteria = summarizeUsage([
      {
        agent: "WHATSAPP",
        metric: "RESPONSES",
        quantity: 2,
        inputTokens: 10,
        cachedTokens: 4,
        outputTokens: 3,
        model: "grok-4.3",
      },
    ]);
    const cafe = summarizeUsage([
      {
        agent: "QUOTES",
        metric: "QUOTES",
        quantity: 1,
        inputTokens: 50,
        cachedTokens: 0,
        outputTokens: 7,
        model: "grok-4.7",
      },
    ]);
    expect(ferreteria.byModel["grok-4.3"].inputTokens).toBe(10);
    expect(ferreteria.byModel["grok-4.7"].inputTokens).toBe(0);
    expect(ferreteria.totals.QUOTES).toBe(0);
    expect(cafe.totals.RESPONSES).toBe(0);
    expect(cafe.byModel["grok-4.7"].outputTokens).toBe(7);
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
