import { machineAgentKind } from "@/lib/computer/agent-kind";
import { computerEnabledForOrg, computerOrgGateClosed, computerUnavailable } from "@/lib/computer/flag";
import { usableLease } from "@/lib/chat/desktop-task";
import { loadTenantLease } from "@/lib/computer/lease";
import { enqueueComputerTask } from "@/lib/computer/orchestrator";
import { prismaComputerStore } from "@/lib/computer/store";
import { missingVaultTable, vaultStatus } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { prepareCredentialUse } from "@/lib/credentials/service";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (computerOrgGateClosed()) return computerUnavailable();
  const session = await resolveSession();
  if (!session) return Response.json({ ok: false, error: "sesion" }, { status: 401 });
  if (!computerEnabledForOrg(session.organizationId)) return computerUnavailable();
  if (!consumeRateLimit(`computer-api:${session.organizationId}`, 20, 60_000).ok) {
    return Response.json({ ok: false, error: "ritmo" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "datos" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { goal?: unknown; credentialId?: unknown; agentKind?: unknown }) : {};
  const goal = typeof record.goal === "string" ? record.goal : "";
  const agentKind = machineAgentKind(typeof record.agentKind === "string" ? record.agentKind : "");
  if (!agentKind) return Response.json({ ok: false, error: "datos" }, { status: 400 });
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
  const looked = await loadTenantLease(session.organizationId);
  const lease = looked.state === "listo" ? usableLease(looked.lease, session.organizationId) : null;
  const result = await enqueueComputerTask(
    {
      clientId: session.organizationId,
      goal,
      agentKind,
      lease,
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
