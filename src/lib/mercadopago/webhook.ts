import { mercadoPagoCall, mercadoPagoAccessToken, mercadoPagoWebhookSecret } from "@/lib/mercadopago/client";
import { verifyMercadoPagoSignature } from "@/lib/mercadopago/signature";
import {
  isMercadoPagoTopic,
  mercadoPagoResourcePath,
  readMercadoPagoDataId,
  readMercadoPagoTopic,
} from "@/lib/mercadopago/state";
import { applyMercadoPagoResource } from "@/lib/mercadopago/apply";
import type { NormalizedPaymentSignal } from "@/lib/payments/types";

function emptySignal(partial: Pick<NormalizedPaymentSignal, "ok" | "httpStatus"> & Partial<NormalizedPaymentSignal>): NormalizedPaymentSignal {
  return {
    provider: "mercadopago",
    repeated: false,
    subscriptionStatus: null,
    ...partial,
  };
}

export async function handleMercadoPagoWebhook(request: Request, fetchImpl: typeof fetch = fetch) {
  if (!mercadoPagoWebhookSecret() || !mercadoPagoAccessToken()) {
    return emptySignal({ ok: false, httpStatus: 503 });
  }

  const url = new URL(request.url);
  const raw = await request.text();
  let body: unknown = null;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  const queryId = url.searchParams.get("data.id")?.trim() ?? "";
  const dataId = queryId || readMercadoPagoDataId(body);
  const verdict = verifyMercadoPagoSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId,
    secret: mercadoPagoWebhookSecret(),
  });
  if (!verdict.ok) return emptySignal({ ok: false, httpStatus: 401 });

  const topic = url.searchParams.get("type")?.trim() || url.searchParams.get("topic")?.trim() || readMercadoPagoTopic(body);
  if (!isMercadoPagoTopic(topic)) return emptySignal({ ok: true, httpStatus: 200 });

  let resource: unknown;
  try {
    resource = await mercadoPagoCall(mercadoPagoResourcePath(topic, verdict.dataId), { method: "GET" }, fetchImpl);
  } catch {
    return emptySignal({ ok: false, httpStatus: 502 });
  }

  const applied = await applyMercadoPagoResource({ topic, dataId: verdict.dataId, resource });
  return emptySignal({
    ok: true,
    httpStatus: 200,
    repeated: applied.repeated,
    subscriptionStatus: applied.status,
  });
}
