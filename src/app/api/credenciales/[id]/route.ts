import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { deleteCredential } from "@/lib/credentials/service";
import { requireVaultSession, vaultErrorResponse, vaultFailure, vaultJson, vaultRate } from "@/lib/credentials/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireVaultSession();
  if (!gate.ok) return gate.response;
  const limited = vaultRate(`boveda-baja:${gate.session.organizationId}`, 20);
  if (limited) return limited;
  const { id } = await context.params;
  try {
    const result = await deleteCredential(prismaCredentialRepo(), {
      organizationId: gate.session.organizationId,
      actorUserId: gate.session.userId,
      credentialId: id,
    });
    if (!result.ok) return vaultFailure(result.error);
    return vaultJson(200, { ok: true });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
