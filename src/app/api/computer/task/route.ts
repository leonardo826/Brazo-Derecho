import { enqueueComputerTask } from "@/lib/computer/orchestrator";
import { prismaComputerStore } from "@/lib/computer/store";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await resolveSession();
  if (!session) return Response.json({ ok: false, error: "sesion" }, { status: 401 });
  if (!consumeRateLimit(`computer-api:${session.organizationId}`, 20, 60_000).ok) {
    return Response.json({ ok: false, error: "ritmo" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "datos" }, { status: 400 });
  }
  const goal = body && typeof body === "object" && "goal" in body ? String((body as { goal?: unknown }).goal ?? "") : "";
  const result = await enqueueComputerTask(
    {
      clientId: session.organizationId,
      goal,
      agentUrl: process.env.COMPUTER_AGENT_URL,
      agentToken: process.env.COMPUTER_AGENT_TOKEN,
    },
    { store: prismaComputerStore() },
  );
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 400 });
  return Response.json({
    ok: true,
    task: {
      id: result.task.id,
      status: result.task.status,
      sensitive: result.task.sensitive,
      result: result.task.result,
    },
  });
}
