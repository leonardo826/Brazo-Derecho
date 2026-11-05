import { requireApiSession } from "@/lib/api-session";
import { plainSpeech } from "@/lib/chat/visible";
import { recordMeter } from "@/lib/meter-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { proxySpeech } from "@/lib/xai/audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  if (!consumeRateLimit(`voz:${session.organizationId}`, 30, 10 * 60 * 1000).ok) {
    return Response.json({ error: "ritmo" }, { status: 429 });
  }
  let body: { texto?: unknown };
  try {
    body = (await request.json()) as { texto?: unknown };
  } catch {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  const raw = typeof body.texto === "string" ? body.texto.trim() : "";
  const text = plainSpeech(raw) || raw;
  return proxySpeech({
    text,
    record: (meter) =>
      recordMeter({
        organizationId: session.organizationId,
        kind: "CHAT",
        model: meter.model,
        tokens: meter.tokens,
      }),
  });
}
