/** @vitest-environment happy-dom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentChat } from "@/components/agent-chat";
import { ComposerDraftBoundary } from "@/components/composer-draft-boundary";
import { LogoutButton } from "@/components/logout-button";
import { purgeComposerDrafts } from "@/lib/chat/composer-draft";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/panel/boveda",
}));

type Identity = { userId: string; organizationId: string; conversationId: string };
type Page = "contador" | "boveda";

const personA: Identity = { userId: "persona-a", organizationId: "empresa-a", conversationId: "contador" };

function setComposer(host: HTMLElement, value: string) {
  const box = host.querySelector("textarea");
  if (!box) throw new Error("sin compositor");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("el marco del panel purga el borrador", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    purgeComposerDrafts();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "",
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    purgeComposerDrafts();
    vi.unstubAllGlobals();
  });

  function show(identity: Identity, page: Page) {
    const chat: ReactNode = createElement(AgentChat, {
      open: true,
      messages: [],
      used: 0,
      limit: 200,
      voice: "navegador",
      draftUserId: identity.userId,
      draftOrganizationId: identity.organizationId,
      draftConversationId: identity.conversationId,
    });
    const vault: ReactNode = createElement("section", { "aria-label": "Bóveda" }, "Bóveda");
    act(() => {
      root.render(
        createElement(
          "div",
          null,
          createElement(LogoutButton),
          createElement(ComposerDraftBoundary, { ...identity, children: page === "contador" ? chat : vault }),
        ),
      );
    });
  }

  function composerValue() {
    return host.querySelector("textarea")?.value ?? "";
  }

  test("A, Bóveda, otra persona y volver no restaura el borrador", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota de la persona A"));
    show(personA, "boveda");
    expect(host.querySelector("textarea")).toBeNull();
    show({ ...personA, userId: "persona-b" }, "boveda");
    show(personA, "boveda");
    show(personA, "contador");
    expect(composerValue()).toBe("");
  });

  test("cambiar de hilo en la Bóveda tampoco restaura el borrador", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota del hilo"));
    show(personA, "boveda");
    show({ ...personA, conversationId: "otro-hilo" }, "boveda");
    show(personA, "contador");
    expect(composerValue()).toBe("");
  });

  test("salir desde la Bóveda borra el borrador antes de volver al Contador", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota antes de salir"));
    show(personA, "boveda");
    const leave = [...host.querySelectorAll("button")].find((button) => button.textContent === "Salir");
    if (!leave) throw new Error("sin salir");
    act(() => leave.click());
    show(personA, "contador");
    expect(composerValue()).toBe("");
  });
});
