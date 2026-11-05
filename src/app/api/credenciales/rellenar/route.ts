import { prisma } from "@/lib/prisma";
import { agentTokenMatches, asRecord, bearerToken, readJson, vaultErrorResponse, vaultFailure, vaultJson, vaultRate } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { redeemFillGrant } from "@/lib/credentials/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Uso interno del computador del cliente. Devuelve usuario y clave una sola vez,
// al agente, para escribirlos en el formulario. No es una ruta del panel:
// no acepta la cookie de sesión y la respuesta no vuelve al chat ni al modelo.
export async function POST(request: Request) {
  const expected = process.env.COMPUTER_AGENT_TOKEN?.trim() ?? "";
  if (!expected) return vaultFailure("boveda_sin_token");
  const limited = vaultRate(`boveda-relleno:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local"}`, 30);
  if (limited) return limited;
  if (!agentTokenMatches(bearerToken(request), expected)) return vaultFailure("token");
  const record = asRecord(await readJson(request));
  if (!record || typeof record.grant !== "string" || typeof record.credentialId !== "string") {
    return vaultFailure("no_autorizado");
  }
  try {
    const result = await redeemFillGrant(
      prismaCredentialRepo(),
      {
        grant: record.grant,
        credentialId: record.credentialId,
        isOrganizationActive: async (organizationId) => {
          const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { suspendedAt: true },
          });
          return Boolean(organization && !organization.suspendedAt);
        },
      },
      process.env,
    );
    if (!result.ok) return vaultFailure(result.error);
    return vaultJson(200, { ok: true, username: result.username, secret: result.secret });
  } catch (error) {
    return vaultErrorResponse(error);
  }
}
