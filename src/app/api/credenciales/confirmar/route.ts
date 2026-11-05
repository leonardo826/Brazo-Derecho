import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { confirmRisk } from "@/lib/credentials/service";
import { asRecord, readJson, requireVaultSession, vaultErrorResponse, vaultFailure, vaultJson, vaultRate } from "@/lib/credentials/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = await requireVaultSession();
  if (!gate.ok) return gate.response;
  const limited = vaultRate(`boveda-confirmacion:${gate.session.organizationId}`, 10);
  if (limited) return limited;
  const record = asRecord(await readJson(request));
  if (!record || record.confirmed !== true) return vaultFailure("boveda_confirmacion");
  try {
    const result = await confirmRisk(prismaCredentialRepo(), {
      organizationId: gate.session.organizationId,
      actorUserId: gate.session.userId,
      action: record.action,
    });
    if (!result.ok) return vaultFailure(result.error);
    return vaultJson(200, {
      ok: true,
      action: result.action,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
