import { applyFlowToken } from "@/lib/flow/apply";
import { flowIsConfigured } from "@/lib/flow/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!flowIsConfigured()) {
    return Response.json({ ok: false, error: "Flow no está configurado" }, { status: 503 });
  }
  const form = await request.formData();
  const token = String(form.get("token") ?? "").trim();
  if (!token || token.length > 200) return Response.json({ ok: false }, { status: 400 });
  const result = await applyFlowToken(token);
  if (!result.ok) return Response.json({ ok: false }, { status: result.status });
  return Response.json({ ok: true, repetido: result.repeated });
}
