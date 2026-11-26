"use server";

import { computerEnabledForOrg } from "@/lib/computer/flag";
import { prewarmOrganization } from "@/lib/computer/prewarm";
import { requireSession } from "@/lib/session";

export async function prewarmComputer() {
  const session = await requireSession();
  return prewarmOrganization({
    enabled: computerEnabledForOrg(session.organizationId),
    organizationId: session.organizationId,
  });
}
