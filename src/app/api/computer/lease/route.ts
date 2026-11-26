import { computerEnabledForOrg, computerOrgGateClosed, computerUnavailable } from "@/lib/computer/flag";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (request.method !== "POST" || computerOrgGateClosed()) return computerUnavailable();
  const session = await resolveSession();
  if (!session || !computerEnabledForOrg(session.organizationId)) return computerUnavailable();
  return computerUnavailable();
}
