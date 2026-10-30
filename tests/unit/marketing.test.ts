import { describe, expect, test } from "vitest";
import { draftImageSvg, toMarketingRecord } from "@/lib/agents/marketing";
import { renderMockTask } from "@/lib/xai/mock";

describe("marketing", () => {
  test("el texto queda como borrador y no dice que ya se publicó", () => {
    const copy = renderMockTask({
      type: "marketing_post",
      channel: "Instagram",
      voice: "cercana y clara",
      audience: "maestros en Santiago",
      summary: "Ferretería de barrio con despacho.",
      index: 0,
    });
    const record = toMarketingRecord({
      channel: "Instagram",
      index: 0,
      copy,
      imagePrompt: "luz natural",
      imageSvg: "<svg></svg>",
    });
    expect(record.status).toBe("DRAFT");
    expect(copy).toContain("maestros en Santiago");
    expect(copy).toContain("Ferretería de barrio con despacho.");
    expect(copy).toMatch(/No está publicado/);
  });

  test("la imagen borrador escapa el texto y avisa que no está publicada", () => {
    const svg = draftImageSvg("Instagram", `Local <script>alert("x")</script>`);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("no publicado");
  });
});
