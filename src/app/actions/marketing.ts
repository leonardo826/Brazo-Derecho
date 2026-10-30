"use server";

import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { assertOwnOrganizationActive, guardMutation, guardRate } from "@/lib/guard";
import { channelFor, draftImageSvg, toMarketingRecord } from "@/lib/agents/marketing";
import { instructionsFor, limitFor, modelFor, routineModel } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { addUsage, EMPTY_USAGE, USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { reserveUsage, usedThisMonth } from "@/lib/usage-store";
import { brandSchema, postBatchSchema } from "@/lib/validation";
import { createXaiClient } from "@/lib/xai/client";

export async function saveBrandAction(formData: FormData) {
  await guardMutation(formData, "/panel/marketing");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/marketing");
  const parsed = brandSchema.safeParse({
    voice: formData.get("voice"),
    audience: formData.get("audience"),
    summary: formData.get("summary"),
  });
  if (!parsed.success) redirect("/panel/marketing?error=marca");
  await prisma.brandProfile.upsert({
    where: { organizationId: session.organizationId },
    create: { organizationId: session.organizationId, ...parsed.data },
    update: parsed.data,
  });
  redirect("/panel/marketing?ok=perfil");
}

export async function generatePostsAction(formData: FormData) {
  await guardMutation(formData, "/panel/marketing");
  const session = await requireSession();
  await assertOwnOrganizationActive(session.organizationId, "/panel/marketing");
  guardRate(`marketing:${session.organizationId}`, 10, 10 * 60 * 1000, "/panel/marketing");
  if (!(await agentIsOpen(session.organizationId, "MARKETING")).open) {
    redirect("/panel/marketing?error=suscripcion");
  }
  const parsedCount = postBatchSchema.safeParse({ count: formData.get("count") ?? 4 });
  if (!parsedCount.success) redirect("/panel/marketing?error=datos");
  const requested = parsedCount.data.count;
  const withImage = formData.get("withImage") === "on";
  const profile = await prisma.brandProfile.findUnique({
    where: { organizationId: session.organizationId },
  });
  if (!profile) redirect("/panel/marketing?error=marca");

  const textRemaining = limitFor("MARKETING", "TEXTS") - (await usedThisMonth(session.organizationId, "TEXTS"));
  const imageRemaining = withImage
    ? limitFor("MARKETING", "IMAGES") - (await usedThisMonth(session.organizationId, "IMAGES"))
    : requested;
  const count = Math.min(requested, textRemaining, imageRemaining);
  if (count < 1) redirect("/panel/marketing?error=limite");

  const client = createXaiClient();
  const drafts: ReturnType<typeof toMarketingRecord>[] = [];
  let textTokens = { ...EMPTY_USAGE };
  let imageTokens = { ...EMPTY_USAGE };
  let textModel: string = modelFor("MARKETING");
  let imageModel: string = routineModel();
  try {
  for (let index = 0; index < count; index += 1) {
    const channel = channelFor(index);
    const text = await client.respond({
      model: textModel,
      instructions: instructionsFor("MARKETING", session.organizationName),
      task: {
        type: "marketing_post",
        channel,
        voice: profile.voice,
        audience: profile.audience,
        summary: profile.summary,
        index,
      },
      usage: USAGE_PRESETS.text,
      businessName: session.organizationName,
      maxOutputTokens: 900,
    });
    textModel = text.model;
    textTokens = addUsage(textTokens, text.usage);
    let imagePrompt = "";
    let imageSvg = "";
    if (withImage) {
      const image = await client.respond({
        model: imageModel,
        instructions: instructionsFor("MARKETING", session.organizationName),
        task: { type: "marketing_image", summary: profile.summary, channel },
        usage: EMPTY_USAGE,
        businessName: session.organizationName,
        maxOutputTokens: 200,
      });
      imageModel = image.model;
      imageTokens = addUsage(imageTokens, image.usage);
      imagePrompt = image.outputText;
      imageSvg = draftImageSvg(channel, imagePrompt);
    }
    drafts.push(
      toMarketingRecord({
        channel,
        index,
        copy: text.outputText,
        imagePrompt,
        imageSvg,
      }),
    );
  }
  } catch {
    redirect("/panel/marketing?error=ia");
  }

  const saved = await prisma.$transaction(async (tx) => {
    const texts = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "MARKETING",
      metric: "TEXTS",
      quantity: drafts.length,
      tokens: textTokens,
      model: textModel,
    });
    if (!texts.ok) return false;
    if (withImage) {
      const images = await reserveUsage(tx, {
        organizationId: session.organizationId,
        agent: "MARKETING",
        metric: "IMAGES",
        quantity: drafts.length,
        tokens: imageTokens,
        model: imageModel,
      });
      if (!images.ok) return false;
    }
    await tx.marketingPost.createMany({
      data: drafts.map((draft) => ({
        organizationId: session.organizationId,
        ...draft,
      })),
    });
    return true;
  });

  if (!saved) redirect("/panel/marketing?error=limite");
  redirect("/panel/marketing?ok=borradores");
}
