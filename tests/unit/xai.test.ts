import { afterEach, describe, expect, test, vi } from "vitest";
import { createXaiClient } from "@/lib/xai/client";
import { MockXaiClient } from "@/lib/xai/mock";
import { USAGE_PRESETS } from "@/lib/pricing";
import { AGENT_CATALOG } from "@/lib/catalog";

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.XAI_MODE = "mock";
});

describe("cliente xAI simulado", () => {
  test("no usa la red", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("no debía haber red");
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await new MockXaiClient().respond({
      model: AGENT_CATALOG.WHATSAPP.model,
      instructions: AGENT_CATALOG.WHATSAPP.instructions,
      task: { type: "whatsapp_escalate" },
      usage: USAGE_PRESETS.whatsapp,
    });
    expect(response.mocked).toBe(true);
    expect(response.outputText).toMatch(/persona del equipo/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("el modo live está rechazado en la beta", () => {
    process.env.XAI_MODE = "live";
    expect(() => createXaiClient()).toThrow(/mock/);
  });
});
