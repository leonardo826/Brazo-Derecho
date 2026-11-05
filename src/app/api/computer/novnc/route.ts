import { localNovncUrl, novncStillValid, safeNovncHref, tokenMatches } from "@/lib/computer/novnc";
import { prisma } from "@/lib/prisma";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await resolveSession();
  if (!session) return Response.json({ ok: false, error: "sesion" }, { status: 401 });
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const computer = await prisma.computer.findUnique({ where: { clientId: session.organizationId } });
  const valid = Boolean(computer && tokenMatches(token, computer.novncTokenHash) && novncStillValid(computer.novncExpiresAt));
  if (!valid || !computer) return Response.json({ ok: false, tokenValido: false }, { status: 403 });
  const local = computer.flyApp ? "" : safeNovncHref(localNovncUrl());
  return Response.json({
    ok: true,
    tokenValido: true,
    expira: computer.novncExpiresAt?.toISOString() ?? null,
    listo: Boolean(local),
    motivo: local ? "noVNC local, solo en este computador." : "Aún no hay máquina. El piloto espera que Leonardo cargue las claves.",
    novncUrl: local || null,
  });
}
