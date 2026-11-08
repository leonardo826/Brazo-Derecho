import { afterEach, describe, expect, test, vi } from "vitest";
import { audioMeterTokens, proxySpeech, proxySpeechToText, silenceWav, ttsRequestBody } from "@/lib/xai/audio";
import { LiveXaiClient } from "@/lib/xai/live";
import { USAGE_PRESETS } from "@/lib/pricing";

const env = {
  XAI_API_KEY: "super-secreto",
  XAI_MODE: "live",
  XAI_API_URL: "https://api.x.ai/v1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voz por el servidor", () => {
  test("sin la API devuelve el respaldo y no llama a la red", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const stt = await proxySpeechToText({
      audio: new Blob(["audio"]),
      filename: "nota.webm",
      env: { XAI_API_KEY: "super-secreto", XAI_MODE: "mock" },
      fetchImpl,
    });
    expect(stt.status).toBe(200);
    expect(await stt.json()).toEqual({ ok: false, fallback: true });
    const tts = await proxySpeech({ text: "Hola", env: { XAI_MODE: "mock" }, fetchImpl });
    expect(await tts.json()).toEqual({ ok: false, fallback: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(silenceWav().byteLength).toBeGreaterThan(44);
  });

  test("la transcripción va a xAI y el error no devuelve la clave", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.x.ai/v1/stt");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer super-secreto");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("grok-voice-transcribe-2.0");
      expect(form.get("language")).toBe("es");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return new Response("super-secreto", { status: 500 });
    });
    const response = await proxySpeechToText({
      audio: new Blob(["audio"], { type: "audio/webm" }),
      filename: "nota.webm",
      env,
      fetchImpl,
    });
    const body = await response.json();
    expect(body).toEqual({ ok: false, fallback: true });
    expect(JSON.stringify(body)).not.toContain("super-secreto");
  });

  test("una transcripción buena anota tokens y no muestra la clave", async () => {
    const record = vi.fn(async (meter: { model: string; tokens: { inputTokens: number; outputTokens: number } }) => {
      expect(meter.model).toBe("grok-voice-transcribe-2.0");
      expect(meter.tokens.inputTokens).toBeGreaterThan(0);
      expect(meter.tokens.outputTokens).toBeGreaterThan(0);
      expect(JSON.stringify(meter)).not.toContain("super-secreto");
    });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ text: "el IVA de octubre", duration: 2.5, language: "es" }),
    );
    const response = await proxySpeechToText({
      audio: new Blob(["audio"]),
      filename: "nota.webm",
      env,
      fetchImpl,
      record,
    });
    expect(await response.json()).toEqual({ ok: true, texto: "el IVA de octubre" });
    expect(record).toHaveBeenCalledOnce();
  });

  test("la voz sale por el proxy, en español, y un fallo no filtra la clave", async () => {
    expect(ttsRequestBody("Hola")).toMatchObject({ voice_id: "eve", language: "es-MX", text: "Hola" });
    const record = vi.fn(async (meter: { model: string }) => {
      expect(meter.model).toBe("grok-tts");
    });
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://api.x.ai/v1/tts");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer super-secreto");
      const body = JSON.parse(String(init?.body));
      expect(body.language).toBe("es-MX");
      expect(body.voice_id).toBe("eve");
      expect(JSON.stringify(body)).not.toContain("super-secreto");
      return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    const response = await proxySpeech({ text: "Hola", env, fetchImpl, record });
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(record).toHaveBeenCalledOnce();
    expect(audioMeterTokens({ characters: 4 }).outputTokens).toBeGreaterThan(0);

    const failed = await proxySpeech({
      text: "Hola",
      env,
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("super-secreto", { status: 502 })),
    });
    expect(JSON.stringify(await failed.json())).not.toContain("super-secreto");
  });

  test("el stream del chat manda la imagen y la búsqueda, sin devolver la clave", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(true);
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(JSON.stringify(body.input)).toContain("input_image");
      expect(JSON.stringify(body)).not.toContain("clave-xai");
      const sse = 'data: {"type":"response.output_text.delta","delta":"Listo"}\n\ndata: {"type":"response.completed","response":{"id":"resp_1","model":"grok-4.7","output_text":"Listo","usage":{"input_tokens":3,"output_tokens":1}}}\n\n';
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const client = new LiveXaiClient({ apiKey: "clave-xai", baseUrl: "https://api.x.ai/v1", fetchImpl });
    const events = [];
    for await (const event of client.streamRespond({
      model: "grok-4.7",
      instructions: "Eres el asistente.",
      usage: USAGE_PRESETS.text,
      webSearch: true,
      task: {
        type: "agent_chat",
        today: "hoy",
        messages: [
          {
            role: "user",
            text: "¿qué es?",
            files: [{ name: "foto.png", mime: "image/png", imageDataUrl: "data:image/png;base64,aaaa" }],
          },
        ],
      },
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual(["delta", "done"]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer clave-xai");
  });
});
