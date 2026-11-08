import { describe, expect, test, vi } from "vitest";
import { PLAN_LIMIT_MESSAGE } from "@/lib/plan-copy";
import { callWithinPlan } from "@/lib/plan-limit";
import { subscriptionForMercadoPago } from "@/lib/mercadopago/state";
import { DAILY_TASK_LIMIT } from "@/lib/usage";
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
  test("al llegar a 30 no llama al modelo", async () => {
    const call = vi.fn(async () => "no");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      loadUsed: async () => 1,
      loadTasks: async () => DAILY_TASK_LIMIT,
      call,
    });
    expect(result).toEqual({ ok: false, reason: "limite", message: PLAN_LIMIT_MESSAGE });
    expect(call).not.toHaveBeenCalled();
  });

  test("con 29 tareas del día la llamada sigue", async () => {
    const call = vi.fn(async () => "listo");
    const result = await callWithinPlan({
      organizationId: "org",
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      loadUsed: async () => 1,
      loadTasks: async () => DAILY_TASK_LIMIT - 1,
      call,
    });
    expect(result).toEqual({ ok: true, value: "listo" });
  });
});
