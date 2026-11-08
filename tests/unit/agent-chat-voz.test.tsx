/** @vitest-environment happy-dom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentChat } from "@/components/agent-chat";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

type FakeEngine = {
  lang: string;
  aborted: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

const engines: FakeEngine[] = [];
const recorders: FakeRecorder[] = [];
let denyMic = false;
let sttBody: { ok?: boolean; texto?: string; fallback?: boolean; error?: string } = { ok: true, texto: "nota de voz" };

class FakeRecorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
  finish() {
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  }
  static isTypeSupported() {
    return true;
  }
}

class FakeRecognition implements FakeEngine {
  lang = "";
  interimResults = false;
  aborted = false;
  onresult: FakeEngine["onresult"] = null;
  onerror: FakeEngine["onerror"] = null;
  onend: FakeEngine["onend"] = null;
  start() {
    engines.push(this);
  }
  abort() {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
  }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("micrófono del Contador", () => {
  let root: Root;
  let host: HTMLDivElement;
  const fetches: string[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    engines.length = 0;
    recorders.length = 0;
    fetches.length = 0;
    denyMic = false;
    sttBody = { ok: true, texto: "nota de voz" };
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      fetches.push(url);
      const body = url.includes("/api/voz/stt") ? sttBody : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (denyMic) throw new DOMException("denied", "NotAllowedError");
          return { getTracks: () => [{ stop() {} }] };
        },
      },
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(voice: "navegador" | "xai" = "navegador") {
    const node: ReactNode = createElement(AgentChat, { open: true, messages: [], used: 0, limit: 200, voice });
    act(() => root.render(node));
  }

  function mic() {
    const button = [...host.querySelectorAll("button")].find((item) => /Micrófono|Detener grabación/.test(item.textContent ?? ""));
    if (!button) throw new Error("sin botón de micrófono");
    return button;
  }

  function composer() {
    const box = host.querySelector("textarea");
    if (!box) throw new Error("sin compositor");
    return box;
  }

  function writeDraft(text: string) {
    const box = composer();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }

  test("dos clics seguidos detienen la escucha y no envían nada", async () => {
    render();
    writeDraft("borrador");
    await act(async () => {
      mic().click();
      mic().click();
    });
    await flush();
    expect(engines).toHaveLength(1);
    expect(engines[0]?.aborted).toBe(true);
    expect(composer().value).toBe("borrador");
    expect(fetches).toEqual([]);
    expect(host.textContent).not.toContain("No pude usar el micrófono");
  });

  test("detener sin resultado conserva el borrador", async () => {
    render();
    writeDraft("borrador");
    await act(async () => {
      mic().click();
    });
    expect(engines).toHaveLength(1);
    await act(async () => {
      mic().click();
    });
    await flush();
    expect(composer().value).toBe("borrador");
    expect(fetches).toEqual([]);
    expect(engines).toHaveLength(1);
  });

  test("un permiso denegado no reintenta otro idioma", async () => {
    render();
    await act(async () => {
      mic().click();
    });
    expect(engines).toHaveLength(1);
    await act(async () => {
      engines[0]?.onerror?.({ error: "not-allowed" });
    });
    await flush();
    expect(engines).toHaveLength(1);
    expect(host.textContent).toContain("No pude usar el micrófono");
    expect(fetches).toEqual([]);
  });

  test("al desmontar se aborta y un resultado tardío no escribe ni reintenta", async () => {
    render();
    await act(async () => {
      mic().click();
    });
    const late = engines[0]?.onresult;
    act(() => root.unmount());
    expect(engines[0]?.aborted).toBe(true);
    late?.({ results: [[{ transcript: "tarde" }]] });
    await flush();
    expect(engines).toHaveLength(1);
    expect(fetches).toEqual([]);
  });

  test("un resultado queda y el cierre tardío no lo borra", async () => {
    render();
    await act(async () => {
      mic().click();
    });
    const engine = engines[0];
    const onend = engine?.onend;
    const onerror = engine?.onerror;
    await act(async () => {
      engine?.onresult?.({ results: [[{ transcript: "IVA del mes" }]] });
    });
    await flush();
    expect(composer().value).toContain("IVA del mes");
    expect(engine?.onresult).toBeNull();
    onend?.();
    onerror?.({ error: "not-allowed" });
    await flush();
    expect(composer().value).toContain("IVA del mes");
    expect(engines).toHaveLength(1);
    expect(host.textContent).not.toContain("No pude usar el micrófono");
    expect(fetches).toEqual([]);
  });

  test("tres clics dejan viva la escucha nueva cuando el cierre viejo llega tarde", async () => {
    render();
    await act(async () => {
      mic().click();
      mic().click();
      mic().click();
    });
    await flush();
    expect(engines).toHaveLength(2);
    expect(engines[0]?.aborted).toBe(true);
    expect(engines[1]?.aborted).toBe(false);
    await act(async () => {
      mic().click();
    });
    expect(engines[1]?.aborted).toBe(true);
    expect(engines).toHaveLength(2);
    expect(fetches).toEqual([]);
  });

  test("en xAI, parar entrega el audio y no envía el chat", async () => {
    render("xai");
    writeDraft("borrador");
    await act(async () => {
      mic().click();
    });
    await flush();
    expect(recorders).toHaveLength(1);
    expect(recorders[0]?.state).toBe("recording");
    await act(async () => {
      mic().click();
    });
    expect(recorders[0]?.state).toBe("inactive");
    await act(async () => {
      recorders[0]?.finish();
    });
    await flush();
    expect(fetches.filter((url) => url.includes("/api/voz/stt"))).toHaveLength(1);
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(false);
    expect(composer().value).toContain("borrador");
    expect(composer().value).toContain("nota de voz");
  });

  test("el onstop tardío de xAI no borra el stop de la sesión nueva", async () => {
    render("xai");
    await act(async () => {
      mic().click();
    });
    await flush();
    const first = recorders[0];
    await act(async () => {
      mic().click();
      mic().click();
    });
    await flush();
    expect(recorders).toHaveLength(2);
    expect(recorders[1]?.state).toBe("recording");
    await act(async () => {
      first?.finish();
    });
    await flush();
    expect(recorders[1]?.state).toBe("recording");
    await act(async () => {
      mic().click();
    });
    expect(recorders[1]?.state).toBe("inactive");
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(false);
  });

  test("sin permiso de xAI no cae al otro idioma", async () => {
    denyMic = true;
    render("xai");
    await act(async () => {
      mic().click();
    });
    await flush();
    expect(recorders).toHaveLength(0);
    expect(engines).toHaveLength(0);
    expect(host.textContent).toContain("No pude usar el micrófono");
    expect(fetches).toEqual([]);
  });

  test("si el servidor pide el navegador, un permiso denegado no reintenta el idioma", async () => {
    sttBody = { ok: false, fallback: true };
    render("xai");
    await act(async () => {
      mic().click();
    });
    await flush();
    await act(async () => {
      mic().click();
      recorders[0]?.finish();
    });
    await flush();
    expect(engines).toHaveLength(1);
    await act(async () => {
      engines[0]?.onerror?.({ error: "not-allowed" });
    });
    await flush();
    expect(engines).toHaveLength(1);
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(false);
  });

  test("desmontar durante xAI no transcribe el audio tardío", async () => {
    render("xai");
    writeDraft("borrador");
    await act(async () => {
      mic().click();
    });
    await flush();
    const pending = recorders[0];
    act(() => root.unmount());
    await act(async () => {
      pending?.finish();
    });
    await flush();
    expect(fetches.filter((url) => url.includes("/api/voz/stt"))).toEqual([]);
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(false);
  });
});
