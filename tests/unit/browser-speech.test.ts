import { describe, expect, test } from "vitest";
import { listenInBrowser, type BrowserSpeech } from "@/lib/chat/browser-speech";

function fakeEngine() {
  const engine: BrowserSpeech = {
    lang: "",
    interimResults: true,
    start() {},
    abort() {
      engine.onerror?.({ error: "aborted" });
    },
    onresult: null,
    onerror: null,
    onend: null,
  };
  return { create: () => engine, engine };
}

describe("escucha del navegador", () => {
  test("sin motor no deja una promesa colgada", () => {
    expect(listenInBrowser("es-CL", () => null)).toBeNull();
  });

  test("detener aborta y la promesa termina", async () => {
    const fake = fakeEngine();
    const session = listenInBrowser("es-CL", fake.create);
    expect(session).not.toBeNull();
    session?.stop();
    await expect(session?.result).rejects.toThrow("abort");
  });

  test("un fallo del motor no es un aborto del usuario", async () => {
    const fake = fakeEngine();
    const session = listenInBrowser("es-CL", fake.create);
    fake.engine.onerror?.({ error: "not-allowed" });
    await expect(session?.result).rejects.toThrow("voz");
  });

  test("detener cierra aunque el motor no avise", async () => {
    const engine: BrowserSpeech = {
      lang: "",
      interimResults: true,
      start() {},
      abort() {},
      onresult: null,
      onerror: null,
      onend: null,
    };
    const session = listenInBrowser("es-CL", () => engine);
    session?.stop();
    await expect(session?.result).rejects.toThrow("abort");
  });

  test("un texto reconocido se devuelve", async () => {
    const fake = fakeEngine();
    const session = listenInBrowser("es-CL", fake.create);
    fake.engine.onresult?.({ results: [[{ transcript: "  IVA del mes  " }]] });
    await expect(session?.result).resolves.toBe("IVA del mes");
  });
});
