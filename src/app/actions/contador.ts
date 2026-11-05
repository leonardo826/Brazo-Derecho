"use server";

import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { instructionsFor, modelFor } from "@/lib/catalog";
import { assertOwnOrganizationActive, guardMutation, guardRate } from "@/lib/guard";
import { callWithinPlan } from "@/lib/plan-limit";
import { prisma } from "@/lib/prisma";
import { USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { recordCompletedTask, recordModelCall } from "@/lib/meter-store";
import { reserveUsage } from "@/lib/usage-store";
import { createXaiClient } from "@/lib/xai/client";

export async function askAccountantAction(formData: FormData) {
  await guardMutation(formData, "/panel/contador");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/contador");
  guardRate(`contador:${session.organizationId}`, 10, 10 * 60 * 1000, "/panel/contador");
  if (!(await agentIsOpen(session.organizationId, "ACCOUNTING")).open) {
    redirect("/panel/contador?error=suscripcion");
  }
  const question = String(formData.get("question") ?? "").trim();
  if (question.length < 5 || question.length > 4000) redirect("/panel/contador?error=datos");

  const today = new Intl.DateTimeFormat("es-CL", { dateStyle: "long", timeZone: "America/Santiago" }).format(new Date());
  const client = createXaiClient();
  let result: Awaited<ReturnType<typeof callWithinPlan<Awaited<ReturnType<typeof client.respond>>>>>;
  try {
    result = await callWithinPlan({
      organizationId: session.organizationId,
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
      call: () =>
        client.respond({
          model: modelFor("ACCOUNTING"),
          instructions: instructionsFor("ACCOUNTING", session.organizationName),
          task: { type: "accounting_question", question, today },
          usage: USAGE_PRESETS.text,
          businessName: session.organizationName,
          maxOutputTokens: 4000,
        }),
    });
  } catch {
    redirect("/panel/contador?error=ia");
  }
  if (!result.ok) redirect("/panel/contador?error=limite");
  const response = result.value;
  await recordModelCall({ organizationId: session.organizationId, response });

  const saved = await prisma.$transaction(async (tx) => {
    const reserved = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "ACCOUNTING",
      metric: "CONSULTS",
      quantity: 1,
      tokens: response.usage,
      model: response.model,
    });
    if (!reserved.ok) return false;
    await recordCompletedTask(tx, {
      organizationId: session.organizationId,
      model: response.model,
      synthetic: response.mocked,
    });
    await tx.accountingConsult.create({
      data: { organizationId: session.organizationId, question, answer: response.outputText },
    });
    return true;
  });
  if (!saved) redirect("/panel/contador?error=limite");
  redirect("/panel/contador?ok=consulta");
}
