import { applyFlowToken } from "@/lib/flow/apply";
import { flowConfig } from "@/lib/flow/client";
import { verifyFlowWebhook } from "@/lib/flow/sign";
import { logEvent } from "@/lib/log";
import { captureException } from "@/lib/sentry";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleFlowPost(request);
  } catch (error) {
    captureException(error, { source: "flow.webhook" });
    logEvent("flow.webhook", { status: 500, reason: "excepcion" });
    return Response.json({ ok: false }, { status: 500 });
  }
}

async function handleFlowPost(request: Request) {
  const config = flowConfig();
  if (!config) {
    logEvent("flow.webhook", { status: 503, reason: "sin_claves" });
    return Response.json({ ok: false, error: "Flow no está configurado" }, { status: 503 });
  }
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  const verdict = verifyFlowWebhook(params, config.secretKey);
  if (!verdict.ok) {
    logEvent("flow.webhook", { status: verdict.status, reason: verdict.reason });
    return Response.json({ ok: false }, { status: verdict.status });
  }
  const result = await applyFlowToken(verdict.token);
  if (!result.ok) {
    logEvent("flow.webhook", { status: result.status, reason: "estado" });
    return Response.json({ ok: false }, { status: result.status });
  }
  logEvent("flow.webhook", { status: 200, repeated: result.repeated });
  return Response.json({ ok: true, repetido: result.repeated });
}
