import { describe, expect, test, vi } from "vitest";
import { PLAN_LIMIT_MESSAGE } from "@/lib/plan-copy";
import { callWithinPlan } from "@/lib/plan-limit";
import { subscriptionForMercadoPago } from "@/lib/mercadopago/state";
import { DAILY_TASK_LIMIT, dayBounds } from "@/lib/usage";
import { trialRestart } from "@/lib/subscription";

const now = new Date("2026-11-08T15:00:00.000Z");

describe("la prueba no pisa un plan vigente", () => {
  test("un plan activo o una prueba abierta se quedan como están", () => {
    const active = { status: "ACTIVE" as const, periodEnd: new Date("2026-12-08T15:00:00.000Z") };
    const trial = { status: "TRIAL" as const, periodEnd: new Date("2026-11-15T15:00:00.000Z") };
    expect(trialRestart(active, now)).toBe("keep");
    expect(trialRestart(trial, now)).toBe("keep");
  });

  test("sin suscripción, o vencida, se puede abrir la prueba", () => {
    expect(trialRestart(null, now)).toBe("open");
    expect(trialRestart({ status: "EXPIRED", periodEnd: new Date("2026-11-01T00:00:00.000Z") }, now)).toBe("open");
    expect(trialRestart({ status: "CANCELED", periodEnd: now }, now)).toBe("open");
  });
});

describe("el aviso de pago no cruza empresas", () => {
  test("referencia y preapproval de dos suscripciones no eligen ninguna", () => {
    expect(
      subscriptionForMercadoPago({
        byReference: { id: "sub-a", mpPreapprovalId: "pre-a" },
        byPreapproval: { id: "sub-b", mpPreapprovalId: "pre-b" },
        preapprovalId: "pre-b",
      }),
    ).toBeNull();
  });

  test("un preapproval distinto al guardado no reescribe esa suscripción", () => {
    expect(
      subscriptionForMercadoPago({
        byReference: { id: "sub-a", mpPreapprovalId: "pre-a" },
        byPreapproval: null,
        preapprovalId: "pre-b",
      }),
    ).toBeNull();
  });

  test("la primera autorización, sin preapproval guardado, sí encuentra la fila", () => {
    expect(
      subscriptionForMercadoPago({
        byReference: { id: "sub-a", mpPreapprovalId: null },
        byPreapproval: null,
        preapprovalId: "pre-nuevo",
      })?.id,
    ).toBe("sub-a");
  });
});

describe("tope de 30 tareas al día", () => {
  test("la reserva llena no llama al modelo", async () => {
    const call = vi.fn(async () => "no");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      loadUsed: async () => 1,
      reserveTask: async () => ({ ok: false, reason: "limite" }),
      call,
    });
    expect(result).toEqual({ ok: false, reason: "limite", message: PLAN_LIMIT_MESSAGE });
    expect(call).not.toHaveBeenCalled();
    expect(DAILY_TASK_LIMIT).toBe(30);
  });

  test("si el modelo falla, se suelta la reserva", async () => {
    const releaseTask = vi.fn(async () => {});
    await expect(
      callWithinPlan({
        organizationId: "org",
        checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
        loadUsed: async () => 1,
        reserveTask: async () => ({ ok: true, reservationId: "reserva-1" }),
        releaseTask,
        call: async () => {
          throw new Error("corte");
        },
      }),
    ).rejects.toThrow("corte");
    expect(releaseTask).toHaveBeenCalledWith("reserva-1");
  });

  test("el día de Chile parte a medianoche y el siguiente empieza donde termina", () => {
    const samples = [
      new Date("2026-01-15T15:00:00.000Z"),
      new Date("2026-04-05T02:30:00.000Z"),
      new Date("2026-09-06T03:30:00.000Z"),
      new Date("2026-11-08T02:59:00.000Z"),
    ];
    for (const now of samples) {
      const bounds = dayBounds(now);
      expect(bounds.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(bounds.end.getTime()).toBeGreaterThan(now.getTime());
      const hours = (bounds.end.getTime() - bounds.start.getTime()) / 3_600_000;
      expect([23, 24, 25]).toContain(hours);
      expect(dayBounds(bounds.end).start.getTime()).toBe(bounds.end.getTime());
    }
  });
});
