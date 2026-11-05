import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { createCredential, listCredentials } from "@/lib/credentials/service";
import { publicCredentialJson } from "@/lib/credentials/types";
import { asRecord, readJson, requireVaultSession, vaultErrorResponse, vaultFailure, vaultJson, vaultRate } from "@/lib/credentials/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireVaultSession();
  if (!gate.ok) return gate.response;
  const limited = vaultRate(`boveda-list:${gate.session.organizationId}`, 60);
  if (limited) return limited;
  try {
    const credentials = await listCredentials(prismaCredentialRepo(), gate.session.organizationId);
    return vaultJson(200, { ok: true, credentials: credentials.map(publicCredentialJson) });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const gate = await requireVaultSession();
  if (!gate.ok) return gate.response;
  const limited = vaultRate(`boveda-alta:${gate.session.organizationId}`, 10);
  if (limited) return limited;
  const record = asRecord(await readJson(request));
  if (!record) return vaultFailure("datos");
  try {
    const result = await createCredential(
      prismaCredentialRepo(),
      {
        organizationId: gate.session.organizationId,
        actorUserId: gate.session.userId,
        label: typeof record.label === "string" ? record.label : "",
        portal: typeof record.portal === "string" ? record.portal : "",
        username: typeof record.username === "string" ? record.username : "",
        secret: typeof record.secret === "string" ? record.secret : "",
        consentAcceptedAt: record.consentAcceptedAt,
      },
      process.env,
    );
    if (!result.ok) return vaultFailure(result.error);
    return vaultJson(201, { ok: true, credential: publicCredentialJson(result.credential) });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
