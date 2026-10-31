import { describe, expect, test } from "vitest";
import { DEMO_TOUR_STEPS, demoTourPathMatches, demoTourStepIndex } from "@/lib/demo-tour";

describe("recorrido de la demo", () => {
  test("parte en el panel y termina en marketing, en cinco pasos", () => {
    expect(DEMO_TOUR_STEPS).toHaveLength(5);
    expect(DEMO_TOUR_STEPS[0]?.title).toBe("Prueba la demo");
    expect(DEMO_TOUR_STEPS[0]?.href).toBe("/panel");
    expect(DEMO_TOUR_STEPS.at(-1)?.href).toBe("/panel/marketing");
    expect(DEMO_TOUR_STEPS.map((step) => step.kicker)).toEqual([
      "Paso 1 de 5",
      "Paso 2 de 5",
      "Paso 3 de 5",
      "Paso 4 de 5",
      "Paso 5 de 5",
    ]);
  });

  test("el texto está en español de Chile y no promete un envío", () => {
    const text = DEMO_TOUR_STEPS.map((step) => `${step.title} ${step.body}`).join("\n");
    expect(text).toMatch(/celular/);
    expect(text).toMatch(/Acá están/);
    expect(text).toMatch(/No se publica/);
    expect(text).toMatch(/no llega a un celular/);
    expect(text).not.toMatch(/vosotros|ordenador|\bmóvil\b|\bvale\b/i);
  });

  test("el inicio no se confunde con el resto del panel", () => {
    expect(demoTourPathMatches("/panel", "/panel")).toBe(true);
    expect(demoTourPathMatches("/panel", "/panel/whatsapp")).toBe(false);
    expect(demoTourPathMatches("/panel/cotizador", "/panel/cotizador")).toBe(true);
    expect(demoTourPathMatches("/panel/cotizador", "/panel/cotizador/abc")).toBe(true);
    expect(demoTourPathMatches("/panel/cotizador", "/panel/whatsapp")).toBe(false);
  });

  test("un paso guardado fuera de rango vuelve al primero", () => {
    expect(demoTourStepIndex(null)).toBe(0);
    expect(demoTourStepIndex("2")).toBe(2);
    expect(demoTourStepIndex("9")).toBe(0);
    expect(demoTourStepIndex("-1")).toBe(0);
    expect(demoTourStepIndex("no")).toBe(0);
  });
});
