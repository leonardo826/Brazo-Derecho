import { escapeXml } from "@/lib/text";

export const MARKETING_CHANNELS = ["Instagram", "Facebook", "Historia de Instagram", "Ficha de Google"] as const;

export type BrandInput = {
  voice: string;
  audience: string;
  summary: string;
};

export function channelFor(index: number) {
  return MARKETING_CHANNELS[index % MARKETING_CHANNELS.length];
}

export function draftImageSvg(channel: string, prompt: string) {
  const safeChannel = escapeXml(channel);
  const safePrompt = escapeXml(prompt.replace(/\s+/g, " ").slice(0, 140));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#14332d"/>
  <rect x="72" y="72" width="936" height="936" fill="none" stroke="#c4512c" stroke-width="8"/>
  <text x="120" y="210" fill="#e7c7b8" font-family="Georgia, serif" font-size="42">${safeChannel}</text>
  <text x="120" y="470" fill="#f4f0e6" font-family="Georgia, serif" font-size="40">${safePrompt}</text>
  <text x="120" y="900" fill="#e7c7b8" font-family="Georgia, serif" font-size="36">Borrador · no publicado</text>
</svg>`;
}

export function toMarketingRecord(input: {
  channel: string;
  index: number;
  copy: string;
  imagePrompt: string;
  imageSvg: string;
}) {
  return {
    title: `${input.channel} · idea ${input.index + 1}`,
    channel: input.channel,
    copy: input.copy,
    imagePrompt: input.imagePrompt,
    imageSvg: input.imageSvg,
    status: "DRAFT" as const,
  };
}
