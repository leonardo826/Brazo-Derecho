import { computerFeatureEnabled, computerUnavailable } from "@/lib/computer/flag";
import { issueNovncToken } from "@/lib/computer/novnc";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!computerFeatureEnabled()) return computerUnavailable();
  const session = await resolveSession();
  if (!session) return Response.json({ ok: false, error: "sesion" }, { status: 401 });
  if (!consumeRateLimit(`novnc-api:${session.organizationId}`, 10, 60_000).ok) {
    return Response.json({ ok: false, error: "ritmo" }, { status: 429 });
  }
  const issued = issueNovncToken();
  await prisma.computer.upsert({
    where: { clientId: session.organizationId },
    update: { novncTokenHash: issued.hash, novncExpiresAt: issued.expiresAt },
    create: { clientId: session.organizationId, novncTokenHash: issued.hash, novncExpiresAt: issued.expiresAt },
  });
  return Response.json({
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt.toISOString(),
    path: `/api/computer/novnc?token=${encodeURIComponent(issued.token)}`,
  });
}
