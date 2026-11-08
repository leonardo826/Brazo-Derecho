/** @vitest-environment happy-dom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentChat, EMPTY_SUGGESTIONS } from "@/components/agent-chat";
import { LogoutButton } from "@/components/logout-button";
import { purgeComposerDrafts, writeComposerDraft } from "@/lib/chat/composer-draft";

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
    localStorage.clear();
    purgeComposerDrafts();
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
    purgeComposerDrafts();
  });

  function render(identity: { userId?: string; organizationId?: string; conversationId?: string } = {}) {
    const userId = identity.userId ?? "usuario-a";
    const organizationId = identity.organizationId ?? "empresa-a";
    const conversationId = identity.conversationId ?? "contador";
    const node: ReactNode = createElement(AgentChat, {
      open: true,
      messages: [],
      used: 0,
      limit: 200,
      voice: "navegador",
      draftUserId: userId,
      draftOrganizationId: organizationId,
      draftConversationId: conversationId,
    });
    const key = `${userId}:${organizationId}:${conversationId}`;
    act(() => root.render(createElement("div", { key }, node)));
  }

  test("el compositor no acepta más de 4000 caracteres", () => {
    render();
    expect(host.querySelector("textarea")?.getAttribute("maxlength")).toBe("4000");
  });

  test("el hilo vacío ofrece sugerencias que solo rellenan el compositor", () => {
    render();
    const buttons = [...host.querySelectorAll("button.suggestion")];
    expect(buttons.map((button) => button.textContent)).toEqual([...EMPTY_SUGGESTIONS]);
    for (const text of EMPTY_SUGGESTIONS) {
      expect(text).not.toMatch(/clave|rut|tarjeta/i);
    }
    act(() => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector("textarea")?.value).toBe(EMPTY_SUGGESTIONS[1]);
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(fetches).toEqual([]);

    act(() => {
      root.render(
        createElement(AgentChat, {
          open: true,
          messages: [
            {
              id: "m1",
              role: "USER",
              kind: "TEXT",
              body: "Hola",
              action: "",
              actionTitle: "",
              confirmation: null,
              createdAt: "2026-11-08T12:00:00.000Z",
              attachments: [],
            },
          ],
          used: 0,
          limit: 200,
          voice: "navegador",
          draftUserId: "usuario-a",
          draftOrganizationId: "empresa-a",
          draftConversationId: "contador",
        }),
      );
    });
    expect(host.querySelector("button.suggestion")).toBeNull();
  });

  test("una sugerencia no pisa un borrador escrito, restaurado o con espacio", () => {
    render();
    const box = host.querySelector("textarea");
    if (!box) throw new Error("sin compositor");
    box.value = "Necesito revisar mis ventas de octubre";
    const stale = host.querySelector("button.suggestion");
    act(() => {
      stale?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(box.value).toBe("Necesito revisar mis ventas de octubre");
    expect(fetches).toEqual([]);

    act(() => {
      setComposer(host, "   ");
    });
    expect(host.querySelector("button.suggestion")).toBeNull();
    expect(host.querySelector("textarea")?.value).toBe("   ");

    const fileInput = host.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) throw new Error("sin adjunto");
    const file = new File(["nota"], "nota.txt", { type: "text/plain" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    act(() => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("nota.txt");
    act(() => {
      setComposer(host, "");
    });
    expect(host.querySelector("button.suggestion")).toBeNull();
    expect(host.textContent).toContain("nota.txt");
    expect(fetches).toEqual([]);
  });

  test("el borrador restaurado de la Bóveda no muestra sugerencias ni se envía", () => {
    writeComposerDraft(
      { userId: "usuario-a", organizationId: "empresa-a", conversationId: "contador" },
      "Necesito revisar mis ventas de octubre",
    );
    render();
    expect(host.querySelector("textarea")?.value).toBe("Necesito revisar mis ventas de octubre");
    expect(host.querySelector("button.suggestion")).toBeNull();
    expect(fetches).toEqual([]);
  });

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

  test("el borrador vive en memoria y se purga al cambiar identidad o salir", () => {
    render();
    act(() => {
      setComposer(host, "nota de la misma persona");
    });
    render({ userId: "usuario-b" });
    expect(host.querySelector("textarea")?.value).toBe("");
    render();
    expect(host.querySelector("textarea")?.value).toBe("");

    act(() => {
      setComposer(host, "nota de la misma persona");
    });
    render({ organizationId: "empresa-b" });
    expect(host.querySelector("textarea")?.value).toBe("");
    render();
    expect(host.querySelector("textarea")?.value).toBe("");

    act(() => {
      setComposer(host, "nota de la misma persona");
    });
    render({ conversationId: "otro-hilo" });
    expect(host.querySelector("textarea")?.value).toBe("");
    render();
    expect(host.querySelector("textarea")?.value).toBe("");

    act(() => {
      setComposer(host, "nota de la misma persona");
    });
    act(() => root.render(createElement("div")));
    render();
    expect(host.querySelector("textarea")?.value).toBe("nota de la misma persona");
    const buttonHost = document.createElement("div");
    document.body.append(buttonHost);
    const buttonRoot = createRoot(buttonHost);
    act(() => buttonRoot.render(createElement(LogoutButton)));
    act(() => {
      buttonHost.querySelector("button")?.click();
    });
    act(() => buttonRoot.unmount());
    buttonHost.remove();
    render();
    expect(host.querySelector("textarea")?.value).toBe("");
  });

  test("una clave sintética sin enviar no entra a almacenamiento ni a la red", () => {
    const marker = ["clave", "sintetica", "no-enviar"].join("-");
    const keys: string[] = [];
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      keys.push(key);
      return setItem.call(this, key, value);
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((item) => String(item)).join(" "));
    });
    render();
    act(() => {
      setComposer(host, marker);
    });
    let leaked = false;
    for (const bag of [localStorage, sessionStorage]) {
      for (let index = 0; index < bag.length; index += 1) {
        const key = bag.key(index) ?? "";
        const value = bag.getItem(key) ?? "";
        if (key.includes(marker) || value.includes(marker)) leaked = true;
      }
    }
    if (keys.some((key) => key.includes(marker)) || logs.some((line) => line.includes(marker))) leaked = true;
    if (fetches.some((url) => url.includes(marker))) leaked = true;
    expect(leaked).toBe(false);
    expect(fetches).toEqual([]);
    expect(host.querySelector("textarea")?.value?.length).toBe(marker.length);
  });

  test("detener devuelve el foco y lo deja si el hilo tiene una selección", async () => {
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
    act(() => stop.click());
    expect(document.activeElement).toBe(typing);
    expect(typing.value).toBe("sigo con el borrador");

    const log = host.querySelector(".agent-log");
    const anchor = document.createTextNode("texto del hilo");
    log?.append(anchor);
    const range = document.createRange();
    range.setStart(anchor, 0);
    range.setEnd(anchor, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const focused: EventTarget[] = [];
    const original = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      focused.push(this);
      return original.call(this, options);
    };
    act(() => stop.click());
    HTMLElement.prototype.focus = original;
    expect(focused.includes(typing)).toBe(false);
    expect(selection?.toString()).toBe("texto");
    expect(typing.value).toBe("sigo con el borrador");
  });
});
