"use server";

import { redirect } from "next/navigation";
import { agentIsOpen } from "@/lib/agent-access";
import { channelFor, draftImageSvg, toMarketingRecord } from "@/lib/agents/marketing";
import { AGENT_CATALOG, limitFor } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { addUsage, EMPTY_USAGE, USAGE_PRESETS } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { reserveUsage, usedThisMonth } from "@/lib/usage-store";
import { brandSchema } from "@/lib/validation";
import { createXaiClient } from "@/lib/xai/client";

export async function saveBrandAction(formData: FormData) {
  const session = await requireSession();
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
  const session = await requireSession();
  if (!(await agentIsOpen(session.organizationId, "MARKETING")).open) {
    redirect("/panel/marketing?error=suscripcion");
  }
  const requested = Number(formData.get("count") ?? 4);
  const withImage = formData.get("withImage") === "on";
  if (!Number.isInteger(requested) || requested < 1 || requested > 8) {
    redirect("/panel/marketing?error=datos");
  }
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
  for (let index = 0; index < count; index += 1) {
    const channel = channelFor(index);
    const text = await client.respond({
      model: AGENT_CATALOG.MARKETING.model,
      instructions: AGENT_CATALOG.MARKETING.instructions,
      task: {
        type: "marketing_post",
        channel,
        voice: profile.voice,
        audience: profile.audience,
        summary: profile.summary,
        index,
      },
      usage: USAGE_PRESETS.text,
    });
    textTokens = addUsage(textTokens, text.usage);
    let imagePrompt = "";
    let imageSvg = "";
    if (withImage) {
      const image = await client.respond({
        model: "grok-imagine-image-2.0",
        instructions: AGENT_CATALOG.MARKETING.instructions,
        task: { type: "marketing_image", summary: profile.summary, channel },
        usage: EMPTY_USAGE,
      });
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

  const saved = await prisma.$transaction(async (tx) => {
    const texts = await reserveUsage(tx, {
      organizationId: session.organizationId,
      agent: "MARKETING",
      metric: "TEXTS",
      quantity: drafts.length,
      tokens: textTokens,
    });
    if (!texts.ok) return false;
    if (withImage) {
      const images = await reserveUsage(tx, {
        organizationId: session.organizationId,
        agent: "MARKETING",
        metric: "IMAGES",
        quantity: drafts.length,
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
