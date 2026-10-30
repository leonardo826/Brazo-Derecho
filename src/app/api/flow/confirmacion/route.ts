import { applyFlowToken } from "@/lib/flow/apply";
import { flowIsConfigured } from "@/lib/flow/client";
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
  if (!flowIsConfigured()) {
    logEvent("flow.webhook", { status: 503, reason: "sin_claves" });
    return Response.json({ ok: false, error: "Flow no está configurado" }, { status: 503 });
  }
  const form = await request.formData();
  const token = String(form.get("token") ?? "").trim();
  if (!token || token.length > 200) {
    logEvent("flow.webhook", { status: 400, reason: "token" });
    return Response.json({ ok: false }, { status: 400 });
  }
  const result = await applyFlowToken(token);
  if (!result.ok) {
    logEvent("flow.webhook", { status: result.status, reason: "estado" });
    return Response.json({ ok: false }, { status: result.status });
  }
  logEvent("flow.webhook", { status: 200, repeated: result.repeated });
  return Response.json({ ok: true, repetido: result.repeated });
}
