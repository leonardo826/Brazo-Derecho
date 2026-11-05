import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  resolveSession: vi.fn(async () => null),
}));

import { GET, POST } from "@/app/api/chat/route";
import { POST as confirmPost } from "@/app/api/chat/confirmacion/route";
import { GET as attachmentGet } from "@/app/api/chat/adjuntos/[id]/route";
import { POST as sttPost } from "@/app/api/voz/stt/route";
import { POST as ttsPost } from "@/app/api/voz/tts/route";
import { resolveSession } from "@/lib/session";

describe("chat y voz sin sesión", () => {
  beforeEach(() => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    process.env.XAI_API_KEY = "super-secreto";
  });

  afterEach(() => {
    delete process.env.XAI_API_KEY;
    vi.unstubAllGlobals();
  });

  test("el hilo, la confirmación y el adjunto exigen sesión", async () => {
    const headers = { "content-type": "application/json" };
    const responses = [
      await POST(new Request("http://localhost/api/chat", { method: "POST", headers, body: '{"texto":"hola"}' })),
      await GET(new Request("http://localhost/api/chat")),
      await confirmPost(
        new Request("http://localhost/api/chat/confirmacion", {
          method: "POST",
          headers,
          body: '{"id":"x","decision":"APPROVED"}',
        }),
      ),
      await attachmentGet(new Request("http://localhost/api/chat/adjuntos/abc"), {
        params: Promise.resolve({ id: "abc" }),
      }),
    ];
    for (const response of responses) {
      const text = await response.text();
      expect(response.status).toBe(401);
      expect(text).toContain("sesion");
      expect(text).not.toContain("super-secreto");
    }
  });

  test("STT y TTS se niegan sin sesión y no llaman a xAI", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new Error("no debía haber red");
    });
    vi.stubGlobal("fetch", fetchImpl);
    const form = new FormData();
    form.set("audio", new Blob(["hola"], { type: "audio/webm" }), "nota.webm");
    const stt = await sttPost(new Request("http://localhost/api/voz/stt", { method: "POST", body: form }));
    const tts = await ttsPost(
      new Request("http://localhost/api/voz/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"texto":"Hola"}',
      }),
    );
    expect(stt.status).toBe(401);
    expect(tts.status).toBe(401);
    expect(await stt.json()).toEqual({ error: "sesion" });
    expect(await tts.json()).toEqual({ error: "sesion" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
