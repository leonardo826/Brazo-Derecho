import { computerFeatureEnabled, computerUnavailable } from "@/lib/computer/flag";
import { enqueueComputerTask } from "@/lib/computer/orchestrator";
import { prismaComputerStore } from "@/lib/computer/store";
import { missingVaultTable, vaultStatus } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { prepareCredentialUse } from "@/lib/credentials/service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!computerFeatureEnabled()) return computerUnavailable();
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
  const record = body && typeof body === "object" ? (body as { goal?: unknown; credentialId?: unknown }) : {};
  const goal = typeof record.goal === "string" ? record.goal : "";
  const credentialId = typeof record.credentialId === "string" ? record.credentialId.trim() : "";
  let agentPayload: { credentials: { id: string; label: string; portal: string; usernameHint: string }[]; fillGrant: string } | undefined;
  try {
    const prepared = await prepareCredentialUse(
      prismaCredentialRepo(),
      {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        goal,
        credentialId: credentialId || undefined,
      },
      process.env,
    );
    if (!prepared.ok) return Response.json({ ok: false, error: prepared.error }, { status: vaultStatus(prepared.error) });
    agentPayload = prepared.agentPayload;
  } catch (error) {
    if (!missingVaultTable(error)) throw error;
    if (credentialId) return Response.json({ ok: false, error: "boveda_migracion" }, { status: 503 });
  }
  const result = await enqueueComputerTask(
    {
      clientId: session.organizationId,
      goal,
      agentUrl: process.env.COMPUTER_AGENT_URL,
      agentToken: process.env.COMPUTER_AGENT_TOKEN,
      agentPayload,
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
