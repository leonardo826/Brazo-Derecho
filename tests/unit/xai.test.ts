import { afterEach, describe, expect, test, vi } from "vitest";
import { complexModel, modelFor, routineModel } from "@/lib/catalog";
import { USAGE_PRESETS } from "@/lib/pricing";
import { AGENT_CATALOG } from "@/lib/catalog";
import { createXaiClient } from "@/lib/xai/client";
import { LiveXaiClient } from "@/lib/xai/live";
import { MockXaiClient } from "@/lib/xai/mock";

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.XAI_MODE = "mock";
  delete process.env.XAI_API_KEY;
  delete process.env.XAI_API_URL;
  delete process.env.XAI_MODEL_ROUTINE;
  delete process.env.XAI_MODEL_COMPLEX;
});

describe("cliente xAI", () => {
  test("el simulador no usa la red", async () => {
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

  test("sin clave usa el simulador aunque el modo diga live", () => {
    delete process.env.XAI_API_KEY;
    process.env.XAI_MODE = "live";
    expect(createXaiClient()).toBeInstanceOf(MockXaiClient);
  });

  test("con XAI_MODE=mock no llama a la red aunque haya clave", () => {
    process.env.XAI_API_KEY = "xai-test";
    process.env.XAI_MODE = "mock";
    expect(createXaiClient()).toBeInstanceOf(MockXaiClient);
  });

  test("con clave llama a la Responses API y anota los tokens reales", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.x.ai/v1/responses");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer xai-test");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("grok-4.3");
      expect(body.instructions).toMatch(/asistente virtual/);
      return new Response(
        JSON.stringify({
          id: "resp_1",
          model: "grok-4.3",
          output_text: "Abrimos a las 9.",
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            input_tokens_details: { cached_tokens: 25 },
          },
        }),
        { status: 200 },
      );
    });
    const client = new LiveXaiClient({
      apiKey: "xai-test",
      baseUrl: "https://api.x.ai/v1",
      fetchImpl: fetchMock as typeof fetch,
    });
    const response = await client.respond({
      model: "grok-4.3",
      instructions: AGENT_CATALOG.WHATSAPP.instructions,
      task: { type: "whatsapp_answer", title: "Horario", body: "De 9 a 19." },
      usage: USAGE_PRESETS.whatsapp,
      businessName: "Ferretería Los Aromos",
    });
    expect(response.mocked).toBe(false);
    expect(response.outputText).toBe("Abrimos a las 9.");
    expect(response.usage).toEqual({ inputTokens: 100, cachedTokens: 25, outputTokens: 40 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("grok-4.3 queda para lo habitual y grok-4.7 para lo complejo", () => {
    expect(routineModel()).toBe("grok-4.3");
    expect(complexModel()).toBe("grok-4.7");
    expect(modelFor("WHATSAPP")).toBe("grok-4.3");
    expect(modelFor("QUOTES")).toBe("grok-4.7");
    expect(modelFor("MARKETING")).toBe("grok-4.7");
    process.env.XAI_MODEL_ROUTINE = "grok-4.7";
    process.env.XAI_MODEL_COMPLEX = "grok-4.3";
    expect(modelFor("WHATSAPP")).toBe("grok-4.7");
    expect(modelFor("QUOTES")).toBe("grok-4.3");
    process.env.XAI_MODEL_ROUTINE = "modelo-inventado";
    expect(routineModel()).toBe("grok-4.3");
  });
});
