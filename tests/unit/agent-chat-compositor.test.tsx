/** @vitest-environment happy-dom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentChat } from "@/components/agent-chat";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

let coarse = false;
const fetches: string[] = [];

function setComposer(host: HTMLElement, value: string) {
  const box = host.querySelector("textarea");
  if (!box) throw new Error("sin compositor");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return box;
}

function pressEnter(box: HTMLTextAreaElement, init: KeyboardEventInit = {}) {
  box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
}

describe("compositor del Contador", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    coarse = false;
    fetches.length = 0;
    sessionStorage.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: coarse && query.includes("coarse"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }));
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      fetches.push(String(input));
      return new Promise<Response>(() => {});
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

  function render(scope = "org-a") {
    const node: ReactNode = createElement(AgentChat, {
      open: true,
      messages: [],
      used: 0,
      limit: 200,
      voice: "navegador",
      draftScope: scope,
    });
    act(() => root.render(createElement("div", { key: scope }, node)));
  }

  test("Enter de escritorio envía y el de un móvil no", () => {
    render();
    const box = setComposer(host, "consulta de IVA");
    act(() => pressEnter(box));
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(true);
    expect(document.activeElement).toBe(box);

    fetches.length = 0;
    coarse = true;
    const mobile = setComposer(host, "en el teléfono");
    act(() => pressEnter(mobile));
    expect(fetches).toEqual([]);
  });

  test("Shift+Enter y la composición no envían; un Enter posterior sí", async () => {
    render();
    const box = setComposer(host, "línea");
    act(() => {
      pressEnter(box, { shiftKey: true });
      pressEnter(box, { isComposing: true });
      const code229 = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(code229, "keyCode", { get: () => 229 });
      box.dispatchEvent(code229);
      box.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "línea" }));
      pressEnter(box);
    });
    expect(fetches).toEqual([]);
    expect(box.value).toBe("línea");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => pressEnter(box));
    expect(fetches.some((url) => url.includes("/api/chat"))).toBe(true);
  });

  test("el borrador vuelve en la misma empresa y no en otra", () => {
    render("org-a");
    act(() => {
      setComposer(host, "borrador de esta empresa");
    });
    render("org-b");
    expect(host.querySelector("textarea")?.value).toBe("");
    render("org-a");
    expect(host.querySelector("textarea")?.value).toBe("borrador de esta empresa");
    act(() => {
      setComposer(host, "");
    });
    render("org-b");
    render("org-a");
    expect(host.querySelector("textarea")?.value).toBe("");
  });

  test("detener devuelve el foco al compositor", async () => {
    render();
    const box = setComposer(host, "detener esta");
    await act(async () => {
      box.form?.requestSubmit();
      await Promise.resolve();
    });
    const typing = setComposer(host, "sigo con el borrador");
    const stop = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Detener respuesta"));
    if (!stop) throw new Error("sin detener");
    (document.activeElement as HTMLElement | null)?.blur();
    stop.focus();
    act(() => stop.click());
    expect(document.activeElement).toBe(typing);
    expect(typing.value).toBe("sigo con el borrador");
  });
});
