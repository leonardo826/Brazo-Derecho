import { z } from "zod";
import { clientErrorBody } from "@/lib/client-error";
import { consumeRateLimit } from "@/lib/rate-limit";
import { captureException } from "@/lib/sentry";

export const dynamic = "force-dynamic";

const clientErrorSchema = z.object({
  source: z.literal("cliente"),
  name: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(300),
});

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return ip.slice(0, 80);
}

export async function POST(request: Request) {
  if (!consumeRateLimit(`observabilidad:${clientIp(request)}`, 30, 60_000).ok) {
    return Response.json({ ok: false }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > 2_000) return Response.json({ ok: false }, { status: 400 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const parsed = clientErrorSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });

  const body = clientErrorBody(parsed.data.name, parsed.data.message);
  const error = new Error(body.message);
  error.name = body.name;
  const result = await captureException(error, { source: "cliente" });
  return Response.json({ ok: true, sent: result.sent });
}
