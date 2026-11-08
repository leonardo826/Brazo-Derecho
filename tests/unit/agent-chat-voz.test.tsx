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
    fetches.length = 0;
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL) => {
        fetches.push(String(input));
        return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
      },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(node: ReactNode = createElement(AgentChat, { open: true, messages: [], used: 0, limit: 200, voice: "navegador" })) {
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
});
