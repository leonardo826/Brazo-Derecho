import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { listAudit } from "@/lib/credentials/service";
import { publicAuditJson } from "@/lib/credentials/types";
import { requireVaultSession, vaultErrorResponse, vaultJson, vaultRate } from "@/lib/credentials/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireVaultSession();
  if (!gate.ok) return gate.response;
  const limited = vaultRate(`boveda-auditoria:${gate.session.organizationId}`, 60);
  if (limited) return limited;
  try {
    const events = await listAudit(prismaCredentialRepo(), gate.session.organizationId);
    return vaultJson(200, { ok: true, events: events.map(publicAuditJson) });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
