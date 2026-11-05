import { requireApiSession } from "@/lib/api-session";
import { recordMeter } from "@/lib/meter-store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { proxySpeechToText } from "@/lib/xai/audio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  if (!consumeRateLimit(`voz:${session.organizationId}`, 30, 10 * 60 * 1000).ok) {
    return Response.json({ error: "ritmo" }, { status: 429 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size <= 0 || audio.size > MAX_AUDIO) {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  const type = audio.type.toLowerCase();
  if (type && !type.startsWith("audio/") && type !== "video/webm" && type !== "application/octet-stream") {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  return proxySpeechToText({
    audio,
    filename: audio.name || "nota.webm",
    record: (meter) =>
      recordMeter({
        organizationId: session.organizationId,
        kind: "CHAT",
        model: meter.model,
        tokens: meter.tokens,
      }),
  });
}
