"use server";

import { redirect } from "next/navigation";
import { isAgentId } from "@/lib/catalog";
import { safePanelPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { trialEnd } from "@/lib/subscription";

export async function activateTrialAction(formData: FormData) {
  const session = await requireSession();
  const agentRaw = String(formData.get("agent") ?? "");
  const back = safePanelPath(String(formData.get("back") ?? "/panel"));
  if (!isAgentId(agentRaw)) redirect(`${back}?error=datos`);

  const now = new Date();
  await prisma.subscription.upsert({
    where: {
      organizationId_agent: {
        organizationId: session.organizationId,
        agent: agentRaw,
      },
    },
    create: {
      organizationId: session.organizationId,
      agent: agentRaw,
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
    },
    update: {
      status: "TRIAL",
      periodStart: now,
      periodEnd: trialEnd(now),
    },
  });
  redirect(`${back}?ok=prueba`);
}
