import { beforeEach, describe, expect, test, vi } from "vitest";
import { FlowApiError, flowCall } from "@/lib/flow/client";
import { startFlowSubscription } from "@/lib/flow/checkout";
import { mercadoPagoCall } from "@/lib/mercadopago/client";
import { startMercadoPagoSubscription } from "@/lib/mercadopago/checkout";
import { prisma } from "@/lib/prisma";
import { IABOT_PRICE_CLP } from "@/lib/subscription";

vi.mock("@/lib/flow/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/flow/client")>("@/lib/flow/client");
  return { ...actual, flowCall: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    subscription: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/mercadopago/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mercadopago/client")>("@/lib/mercadopago/client");
  return {
    ...actual,
    mercadoPagoCall: vi.fn(),
    mercadoPagoIsConfigured: () => true,
    mercadoPagoAccessToken: () => "TEST-token",
  };
});

vi.mock("@/lib/qa-account", () => ({ assertBillableOrganization: vi.fn() }));
vi.mock("@/lib/trial-guard", () => ({ beginTrialIfIdle: vi.fn() }));

const call = vi.mocked(flowCall);
const organization = vi.mocked(prisma.organization.findUniqueOrThrow);
const subscriptionFind = vi.mocked(prisma.subscription.findUnique);
const subscriptionUpdate = vi.mocked(prisma.subscription.update);

function paths() {
  return call.mock.calls.map((entry) => entry[0]);
}

beforeEach(() => {
  call.mockReset();
  organization.mockReset();
  subscriptionFind.mockReset();
  subscriptionUpdate.mockReset();
  process.env.APP_URL = "http://127.0.0.1:3118";
  delete process.env.IABOT_PRICE_CLP;
  organization.mockResolvedValue({ id: "org-1", name: "Taller", flowCustomerId: null } as never);
  subscriptionUpdate.mockResolvedValue({} as never);
});

describe("oferta publicada en Flow", () => {
  test("un plan nuevo del Contador se crea en 63546 y no en el neto antiguo", async () => {
    subscriptionFind.mockResolvedValue(null);
    const published = {
      planId: "brazo-contador",
      amount: IABOT_PRICE_CLP,
      currency: "CLP",
      interval: 3,
      interval_count: 1,
    };
    let reads = 0;
    call.mockImplementation(async (path: string) => {
      if (path === "plans/get") {
        reads += 1;
        if (reads === 1) throw new FlowApiError("no está", 404);
        return published;
      }
      if (path === "plans/create") return { planId: "brazo-contador" };
      if (path === "customer/create") return { customerId: "cus_1" };
      if (path === "subscription/create") return { subscriptionId: "sus_1" };
      if (path === "customer/register") return { url: "https://sandbox.flow.cl/app/pay", token: "tok" };
      throw new Error(path);
    });

    await startFlowSubscription({
      organizationId: "org-1",
      organizationName: "Taller",
      email: "ana@test.local",
      name: "Ana",
      agent: "ACCOUNTING",
    });

    const create = call.mock.calls.find((entry) => entry[0] === "plans/create");
    expect(create?.[1]).toMatchObject({
      amount: IABOT_PRICE_CLP,
      planId: "brazo-contador",
      currency: "CLP",
      interval: 3,
      interval_count: 1,
    });
    expect(create?.[1]).not.toMatchObject({ amount: 53538 });
    expect(subscriptionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountClp: 63546 }) }),
    );
    expect(paths()).not.toContain("payment/create");
  });

  test("un plan Flow con el monto viejo no inicia el checkout", async () => {
    subscriptionFind.mockResolvedValue(null);
    call.mockResolvedValue({ planId: "brazo-contador", amount: 53538 });

    await expect(
      startFlowSubscription({
        organizationId: "org-1",
        organizationName: "Taller",
        email: "ana@test.local",
        name: "Ana",
        agent: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(paths()).toEqual(["plans/get"]);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  test("un plan Flow sin monto comprobable tampoco inicia el checkout", async () => {
    subscriptionFind.mockResolvedValue(null);
    call.mockResolvedValue({ planId: "brazo-contador" });

    await expect(
      startFlowSubscription({
        organizationId: "org-1",
        organizationName: "Taller",
        email: "ana@test.local",
        name: "Ana",
        agent: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(paths()).toEqual(["plans/get"]);
  });

  test("si el plan recién creado no se puede leer, no sigue el checkout", async () => {
    subscriptionFind.mockResolvedValue(null);
    let reads = 0;
    call.mockImplementation(async (path: string) => {
      if (path === "plans/get") {
        reads += 1;
        if (reads === 1) throw new FlowApiError("no está", 404);
        throw new FlowApiError("Flow no responde", 500);
      }
      if (path === "plans/create") return { planId: "brazo-contador" };
      throw new Error(path);
    });

    await expect(
      startFlowSubscription({
        organizationId: "org-1",
        organizationName: "Taller",
        email: "ana@test.local",
        name: "Ana",
        agent: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ status: 500 });

    expect(paths()).toEqual(["plans/get", "plans/create", "plans/get"]);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  test("un error de consulta no crea un plan", async () => {
    subscriptionFind.mockResolvedValue(null);
    call.mockRejectedValue(new FlowApiError("Flow no responde", 500));

    await expect(
      startFlowSubscription({
        organizationId: "org-1",
        organizationName: "Taller",
        email: "ana@test.local",
        name: "Ana",
        agent: "ACCOUNTING",
      }),
    ).rejects.toMatchObject({ status: 500 });

    expect(paths()).toEqual(["plans/get"]);
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  test("moneda o período distintos no inician el checkout", async () => {
    subscriptionFind.mockResolvedValue(null);
    for (const remote of [
      { planId: "brazo-contador", amount: 63546, currency: "UF", interval: 3, interval_count: 1 },
      { planId: "brazo-contador", amount: 63546, currency: "CLP", interval: 4, interval_count: 1 },
      { planId: "brazo-contador", amount: 63546, currency: "CLP", interval: 3 },
    ]) {
      call.mockReset();
      call.mockResolvedValue(remote);
      await expect(
        startFlowSubscription({
          organizationId: "org-1",
          organizationName: "Taller",
          email: "ana@test.local",
          name: "Ana",
          agent: "ACCOUNTING",
        }),
      ).rejects.toMatchObject({ status: 409, code: "flow_precio" });
      expect(paths()).toEqual(["plans/get"]);
    }
  });

  test("una suscripción Flow ya activa no se toca ni llama a Flow", async () => {
    subscriptionFind.mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      flowSubscriptionId: "sus_vieja",
      amountClp: 47588,
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
    } as never);

    await expect(
      startFlowSubscription({
        organizationId: "org-1",
        organizationName: "Taller",
        email: "ana@test.local",
        name: "Ana",
        agent: "WHATSAPP",
      }),
    ).rejects.toMatchObject({ status: 409, code: "flow_activa" });

    expect(call).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });
});

describe("oferta publicada en Mercado Pago", () => {
  test("el payload usa 63546 aunque quien llama pase el neto antiguo", async () => {
    subscriptionFind.mockResolvedValue({
      id: "sub-1",
      status: "TRIAL",
      mpPreapprovalId: null,
      amountClp: null,
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
    } as never);
    subscriptionUpdate.mockResolvedValue({
      id: "sub-1",
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
      mpPreapprovalId: null,
    } as never);
    vi.mocked(mercadoPagoCall).mockResolvedValue({ id: "pre-1", init_point: "https://example.test/pay" });

    await startMercadoPagoSubscription({
      organizationId: "org-1",
      agent: "ACCOUNTING",
      payerEmail: "ana@test.local",
      amountClp: 53538,
    });

    expect(vi.mocked(mercadoPagoCall)).toHaveBeenCalledWith(
      "/preapproval",
      expect.objectContaining({
        body: expect.objectContaining({
          auto_recurring: expect.objectContaining({ transaction_amount: 63546, currency_id: "CLP" }),
        }),
      }),
      expect.any(Function),
    );
  });

  test("repetir el checkout de una suscripción activa no escribe ni llama a Mercado Pago", async () => {
    subscriptionFind.mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      mpPreapprovalId: "pre-viejo",
      amountClp: 47588,
      periodEnd: new Date("2026-12-01T00:00:00.000Z"),
    } as never);

    await expect(
      startMercadoPagoSubscription({
        organizationId: "org-1",
        agent: "ACCOUNTING",
        payerEmail: "ana@test.local",
        amountClp: 63546,
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(vi.mocked(mercadoPagoCall)).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });
});
