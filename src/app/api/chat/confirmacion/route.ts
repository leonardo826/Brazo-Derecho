import { requireApiSession } from "@/lib/api-session";
import { chatSurface, isChatAgent } from "@/lib/chat/agents";
import { streamDecision } from "@/lib/chat/run";
import { sseResponse } from "@/lib/chat/sse";
import { agentIsOpen } from "@/lib/agent-access";
import { planRoom } from "@/lib/plan-limit";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  if (!consumeRateLimit(`chat:${session.organizationId}`, 20, 10 * 60 * 1000).ok) {
    return Response.json({ error: "ritmo" }, { status: 429 });
  }
  let body: { id?: unknown; decision?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; decision?: unknown };
  } catch {
    return Response.json({ error: "datos" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const decision = body.decision === "APPROVED" || body.decision === "CANCELED" ? body.decision : null;
  if (!id || !decision) return Response.json({ error: "datos" }, { status: 400 });
  const row = await prisma.agentMessage.findFirst({
    where: { id, kind: "CONFIRMATION", thread: { organizationId: session.organizationId } },
    select: { thread: { select: { agent: true } } },
  });
  if (!row || !isChatAgent(row.thread.agent)) return Response.json({ error: "confirmacion" }, { status: 404 });
  const agent = row.thread.agent;
  const access = await agentIsOpen(session.organizationId, agent);
  if (!access.open) {
    return Response.json({ error: access.suspended ? "suspendida" : "suscripcion" }, { status: 403 });
  }
  if (decision === "APPROVED") {
    const room = await planRoom({
      organizationId: session.organizationId,
      checks: [{ agent, metric: chatSurface(agent).metric, quantity: 1 }],
    });
    if (!room.ok) return Response.json({ error: "limite" }, { status: 409 });
  }
  return sseResponse(
    (signal) =>
      streamDecision({
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        actorUserId: session.userId,
        messageId: id,
        decision,
        signal,
      }),
    request.signal,
  );
}
