import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { POST as mercadoPagoPost } from "@/app/api/mercadopago/webhook/route";
import { startMercadoPagoSubscription } from "@/lib/mercadopago/checkout";
import { mercadoPagoManifest, signMercadoPagoManifest } from "@/lib/mercadopago/signature";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { resetRateLimits } from "@/lib/rate-limit";
import { trialEnd } from "@/lib/subscription";

const SECRET = "whsec-integracion";
const TOKEN = "TEST-access-token";
const createdUsers: string[] = [];
const createdOrgs: string[] = [];

async function makeOrg() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `mp-${suffix}@test.local`,
      name: "Ana Mercado",
      passwordHash: await hashPassword("Clave-demo-2026"),
      memberships: {
        create: {
          role: "OWNER",
          organization: { create: { name: "Pago MP", slug: `mp-${suffix}` } },
        },
      },
    },
    include: { memberships: true },
  });
  createdUsers.push(user.id);
  const organizationId = user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("No quedó la empresa");
  createdOrgs.push(organizationId);
  return { organizationId, email: user.email };
}

function webhookRequest(input: { dataId: string; topic: string; body: unknown; ts?: string; signature?: string }) {
  const ts = input.ts ?? String(Math.floor(Date.now() / 1000));
  const requestId = "req-integracion";
  const manifest = mercadoPagoManifest(input.dataId, requestId, ts);
  const v1 = input.signature ?? signMercadoPagoManifest(manifest, SECRET);
  const url = `http://localhost/api/mercadopago/webhook?data.id=${encodeURIComponent(input.dataId)}&type=${encodeURIComponent(input.topic)}`;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-forwarded-for": "203.0.113.20",
    },
    body: JSON.stringify(input.body),
  });
}

const previousAppUrl = process.env.APP_URL;

afterEach(() => {
  resetRateLimits();
  vi.unstubAllGlobals();
  delete process.env.MERCADOPAGO_ACCESS_TOKEN;
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

afterAll(async () => {
  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId: { in: createdOrgs } },
    select: { id: true },
  });
  const ids = subscriptions.map((item) => item.id);
  if (ids.length > 0) await prisma.mercadoPagoNotice.deleteMany({ where: { subscriptionId: { in: ids } } });
  if (createdOrgs.length > 0) await prisma.organization.deleteMany({ where: { id: { in: createdOrgs } } });
  if (createdUsers.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe("webhook de Mercado Pago", () => {
  test("la firma válida consulta la API y deja el agente activo, sin creer el cuerpo", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = TOKEN;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
    const { organizationId } = await makeOrg();
    const now = new Date();
    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        agent: "WHATSAPP",
        status: "TRIAL",
        periodStart: now,
        periodEnd: trialEnd(now),
      },
    });
    const preapprovalId = `pre-${subscription.id}`;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: preapprovalId,
        status: "authorized",
        external_reference: subscription.id,
        payer_email: "Ana@Ejemplo.cl",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await mercadoPagoPost(
      webhookRequest({
        dataId: preapprovalId,
        topic: "subscription_preapproval",
        body: { status: "cancelled", data: { id: preapprovalId } },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, repetido: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`,
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.provider).toBe("MERCADOPAGO");
    expect(updated.mpPreapprovalId).toBe(preapprovalId);
    expect(updated.mpPayerEmail).toBe("ana@ejemplo.cl");
    const periodEnd = updated.periodEnd.getTime();

    const again = await mercadoPagoPost(
      webhookRequest({
        dataId: preapprovalId,
        topic: "subscription_preapproval",
        body: { status: "authorized" },
      }),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, repetido: true });
    const second = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(second.periodEnd.getTime()).toBe(periodEnd);
    expect(second.status).toBe("ACTIVE");
  });

  test("un pago rechazado deja la suscripción vencida y una firma inválida no la toca", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = TOKEN;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRET;
    const { organizationId } = await makeOrg();
    const now = new Date();
    const subscription = await prisma.subscription.create({
      data: {
        organizationId,
        agent: "QUOTES",
        status: "ACTIVE",
        provider: "MERCADOPAGO",
        periodStart: new Date(now.getTime() - 40 * 86_400_000),
        periodEnd: new Date(now.getTime() - 86_400_000),
        mpPreapprovalId: `pre-quotes-${organizationId}`,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          id: 991,
          status: "rejected",
          external_reference: subscription.id,
        }),
      ),
    );

    const rejected = await mercadoPagoPost(
      webhookRequest({ dataId: "991", topic: "payment", body: { status: "approved", data: { id: "991" } } }),
    );
    expect(rejected.status).toBe(200);
    const expired = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(expired.status).toBe("EXPIRED");

    const invalid = await mercadoPagoPost(
      webhookRequest({
        dataId: "991",
        topic: "payment",
        body: { status: "approved" },
        signature: "f".repeat(64),
      }),
    );
    expect(invalid.status).toBe(401);
    const untouched = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(untouched.status).toBe("EXPIRED");
  });

  test("crear la suscripción manda external_reference y redirige a init_point", async () => {
    process.env.MERCADOPAGO_ACCESS_TOKEN = TOKEN;
    process.env.APP_URL = "http://localhost:3000";
    const { organizationId, email } = await makeOrg();
    let sent = "";
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      sent = String(init?.body ?? "");
      const reference = JSON.parse(sent).external_reference as string;
      return Response.json({ id: "pre-nueva", init_point: "https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=pre-nueva", external_reference: reference });
    });
    const redirectUrl = await startMercadoPagoSubscription(
      { organizationId, agent: "MARKETING", payerEmail: email, amountClp: 41638 },
      fetchMock,
    );
    expect(redirectUrl).toBe("https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=pre-nueva");
    const body = JSON.parse(sent);
    const saved = await prisma.subscription.findUniqueOrThrow({
      where: { organizationId_agent: { organizationId, agent: "MARKETING" } },
    });
    expect(body.external_reference).toBe(saved.id);
    expect(body.payer_email).toBe(email);
    expect(body.notification_url).toBe("http://localhost:3000/api/mercadopago/webhook");
    expect(body.back_url).toBe("http://localhost:3000/panel/pago");
    expect(body.auto_recurring.currency_id).toBe("CLP");
    expect(body.auto_recurring.frequency_type).toBe("months");
    expect(sent).not.toContain("free_trial");
    expect(sent).not.toContain(TOKEN);
    expect(saved.provider).toBe("MERCADOPAGO");
    expect(saved.mpPreapprovalId).toBe("pre-nueva");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.mercadopago.com/preapproval");
  });
});
