import { createHmac } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as mercadoPagoPost } from "@/app/api/mercadopago/webhook/route";
import { FLOW_PAYMENT, FLOW_SUBSCRIPTION, nextSubscriptionState } from "@/lib/flow/state";
import { mercadoPagoCall } from "@/lib/mercadopago/client";
import { buildPreapprovalPayload } from "@/lib/mercadopago/checkout";
import {
  mercadoPagoManifest,
  MERCADOPAGO_TS_TOLERANCE_MS,
  signMercadoPagoManifest,
  verifyMercadoPagoSignature,
} from "@/lib/mercadopago/signature";
import { mercadoPagoResourcePath, mercadoPagoToFlowSignal } from "@/lib/mercadopago/state";
import { appUrl } from "@/lib/env";
import { getPaymentProvider, listPaymentProviders } from "@/lib/payments/registry";
import { resetRateLimits } from "@/lib/rate-limit";
import { paymentProviderSchema } from "@/lib/validation";

const SECRET = "whsec-test";
const NOW = Date.parse("2026-10-31T15:00:00.000Z");

afterEach(() => {
  resetRateLimits();
  vi.unstubAllGlobals();
  delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  delete process.env.MERCADOPAGO_PUBLIC_KEY;
  delete process.env.FLOW_API_KEY;
  delete process.env.FLOW_SECRET_KEY;
});

function signed(dataId: string, requestId: string, ts: string, secret = SECRET) {
  const manifest = mercadoPagoManifest(dataId, requestId, ts);
  return signMercadoPagoManifest(manifest, secret);
}

describe("firma de Mercado Pago", () => {
  test("acepta el manifiesto oficial con comparación en tiempo constante", () => {
    const dataId = "abc123XYZ";
    const requestId = "req-1";
    const ts = String(Math.floor(NOW / 1000));
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    expect(mercadoPagoManifest(dataId, requestId, ts)).toBe(manifest);
    const v1 = createHmac("sha256", SECRET).update(manifest).digest("hex");
    expect(signed(dataId, requestId, ts)).toBe(v1);
    expect(
      verifyMercadoPagoSignature(
        { xSignature: `ts=${ts},v1=${v1}`, xRequestId: requestId, dataId, secret: SECRET },
        NOW,
      ),
    ).toEqual({ ok: true, dataId: dataId.toLowerCase(), ts });
    expect(
      verifyMercadoPagoSignature(
        { xSignature: `ts=${ts}, v1=${v1.toUpperCase()}`, xRequestId: requestId, dataId, secret: SECRET },
        NOW,
      ).ok,
    ).toBe(true);
  });

  test("rechaza una firma inválida", () => {
    const ts = String(Math.floor(NOW / 1000));
    const verdict = verifyMercadoPagoSignature(
      {
        xSignature: `ts=${ts},v1=${"ab".repeat(32)}`,
        xRequestId: "req-1",
        dataId: "123",
        secret: SECRET,
      },
      NOW,
    );
    expect(verdict).toMatchObject({ ok: false, status: 401, reason: "firma" });
    expect(
      verifyMercadoPagoSignature(
        { xSignature: `ts=${ts},v1=${signed("123", "req-1", ts)}`, xRequestId: "otro", dataId: "123", secret: SECRET },
        NOW,
      ),
    ).toMatchObject({ ok: false, status: 401, reason: "firma" });
  });

  test("rechaza un ts vencido", () => {
    const ts = String(Math.floor((NOW - MERCADOPAGO_TS_TOLERANCE_MS - 1_000) / 1000));
    const v1 = signed("pre_1", "req-1", ts);
    expect(
      verifyMercadoPagoSignature(
        { xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "pre_1", secret: SECRET },
        NOW,
      ),
    ).toMatchObject({ ok: false, status: 401, reason: "ts" });
  });
});

describe("mapeo de estados", () => {
  const now = new Date("2026-10-30T15:00:00.000Z");
  const trial = { status: "TRIAL" as const, periodEnd: new Date("2026-11-10T15:00:00.000Z") };
  const vencida = { status: "ACTIVE" as const, periodEnd: new Date("2026-10-01T00:00:00.000Z") };

  test("authorized deja el plan activo un mes", () => {
    const signal = mercadoPagoToFlowSignal("subscription_preapproval", { status: "authorized" });
    expect(signal).toEqual({ paymentStatus: FLOW_PAYMENT.PAID });
    const next = nextSubscriptionState(trial, signal ?? {}, now);
    expect(next?.status).toBe("ACTIVE");
    expect(next && next.periodEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  test("paused y cancelled cancelan", () => {
    for (const status of ["paused", "cancelled", "canceled"]) {
      const signal = mercadoPagoToFlowSignal("subscription_preapproval", { status });
      expect(signal).toEqual({ subscriptionStatus: FLOW_SUBSCRIPTION.CANCELED });
      expect(nextSubscriptionState(trial, signal ?? {}, now)?.status).toBe("CANCELED");
    }
  });

  test("un pago rechazado o vencido expira fuera de la prueba", () => {
    const rejected = mercadoPagoToFlowSignal("payment", { status: "rejected" });
    const overdue = mercadoPagoToFlowSignal("subscription_authorized_payment", {
      status: "processed",
      payment: { status: "expired" },
    });
    expect(rejected).toEqual({ paymentStatus: FLOW_PAYMENT.REJECTED });
    expect(overdue).toEqual({ paymentStatus: FLOW_PAYMENT.REJECTED });
    expect(nextSubscriptionState(trial, rejected ?? {}, now)).toBeNull();
    expect(nextSubscriptionState(vencida, rejected ?? {}, now)?.status).toBe("EXPIRED");
    expect(nextSubscriptionState(vencida, overdue ?? {}, now)?.status).toBe("EXPIRED");
  });

  test("arma la ruta de consulta según el tópico", () => {
    expect(mercadoPagoResourcePath("subscription_preapproval", "pre 1")).toBe("/preapproval/pre%201");
    expect(mercadoPagoResourcePath("subscription_authorized_payment", "88")).toBe("/authorized_payments/88");
    expect(mercadoPagoResourcePath("payment", "99")).toBe("/v1/payments/99");
  });
});

describe("creación y proveedor", () => {
  test("el POST de preapproval usa el token y no llama a la API sin clave", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      mercadoPagoCall("/preapproval", { method: "POST", body: { payer_email: "a@b.cl" } }, fetchMock),
    ).rejects.toThrow(/no está configurado/);
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-access-token";
    const payload = buildPreapprovalPayload({
      subscriptionId: "sub_1",
      payerEmail: "ana@ejemplo.cl",
      reason: "Atención WhatsApp",
      amountClp: 47588,
    });
    expect(payload.notification_url).toBe(`${appUrl()}/api/mercadopago/webhook`);
    expect(payload.back_url).toBe(`${appUrl()}/panel/pago`);
    expect(payload.external_reference).toBe("sub_1");
    expect(payload.auto_recurring).toEqual({
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 47588,
      currency_id: "CLP",
    });
    expect(payload).not.toHaveProperty("free_trial");
    expect(payload.auto_recurring).not.toHaveProperty("free_trial");

    fetchMock.mockResolvedValue(Response.json({ id: "pre_1", init_point: "https://www.mercadopago.cl/subscriptions/checkout" }));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    await mercadoPagoCall("/preapproval", { method: "POST", body: payload }, fetchMock);
    spy.mockRestore();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.mercadopago.com/preapproval");
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer TEST-access-token");
    expect(String(init?.body)).not.toContain("TEST-access-token");
    expect(logs.join("\n")).not.toContain("TEST-access-token");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("TEST-access-token");
  });

  test("el registro elige Flow o Mercado Pago y Zod rechaza otro medio", () => {
    expect(listPaymentProviders().map((provider) => provider.id)).toEqual(["flow", "mercadopago"]);
    expect(getPaymentProvider("flow").id).toBe("flow");
    expect(getPaymentProvider("flow").isConfigured()).toBe(false);
    expect(getPaymentProvider("mercadopago").isConfigured()).toBe(false);
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-access-token";
    expect(getPaymentProvider("mercadopago").isConfigured()).toBe(true);
    expect(getPaymentProvider("flow").isConfigured()).toBe(false);
    process.env.FLOW_API_KEY = "api-key";
    process.env.FLOW_SECRET_KEY = "super-secret";
    expect(getPaymentProvider("flow").isConfigured()).toBe(true);
    expect(paymentProviderSchema.parse("flow")).toBe("flow");
    expect(paymentProviderSchema.parse("mercadopago")).toBe("mercadopago");
    expect(paymentProviderSchema.safeParse("stripe").success).toBe(false);
  });

  test("el proveedor flow reutiliza el aviso existente", async () => {
    const signal = await getPaymentProvider("flow").handleWebhook(
      new Request("http://localhost/api/flow/confirmacion", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: "TOK123" }),
      }),
    );
    expect(signal.provider).toBe("flow");
    expect(signal.httpStatus).toBe(503);
    expect(signal.ok).toBe(false);
  });
});

describe("POST /api/mercadopago/webhook", () => {
  test("sin claves no procesa el aviso", async () => {
    const response = await mercadoPagoPost(
      new Request("http://localhost/api/mercadopago/webhook?data.id=1&type=payment", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(503);
  });

  test("una firma inválida responde 401 y no llama a la API", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-access-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const ts = String(Math.floor(Date.now() / 1000));
    const response = await mercadoPagoPost(
      new Request("http://localhost/api/mercadopago/webhook?data.id=pre_1&type=subscription_preapproval", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-1",
          "x-signature": `ts=${ts},v1=${"0".repeat(64)}`,
        },
        body: JSON.stringify({ type: "subscription_preapproval", data: { id: "pre_1" }, status: "authorized" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("corta cuando se pasa el límite de avisos", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-access-token";
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
    const request = () =>
      mercadoPagoPost(
        new Request("http://localhost/api/mercadopago/webhook?data.id=1&type=payment", {
          method: "POST",
          headers: { "x-forwarded-for": "203.0.113.9", "x-signature": "ts=1,v1=00", "x-request-id": "req" },
          body: "{}",
        }),
      );
    for (let i = 0; i < 60; i += 1) {
      expect((await request()).status).toBe(401);
    }
    expect((await request()).status).toBe(429);
  });
});
