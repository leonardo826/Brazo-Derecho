/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AgentChat } from "@/components/agent-chat";
import { ComposerDraftBoundary } from "@/components/composer-draft-boundary";
import { LogoutButton } from "@/components/logout-button";
import {
  alignComposerDraftEpoch,
  purgeComposerDrafts,
  readComposerDraft,
  restoreComposerDraft,
  writeComposerDraft,
} from "@/lib/chat/composer-draft";

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
    const chat = (
      <AgentChat
        open
        messages={[]}
        used={0}
        limit={200}
        voice="navegador"
        draftUserId={identity.userId}
        draftOrganizationId={identity.organizationId}
        draftConversationId={identity.conversationId}
      />
    );
    act(() => {
      root.render(
        <div>
          <LogoutButton />
          <ComposerDraftBoundary {...identity}>{page === "contador" ? chat : <section aria-label="Bóveda">Bóveda</section>}</ComposerDraftBoundary>
        </div>,
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

  test("la misma persona conserva el borrador al ir a la Bóveda y volver", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota de la misma sesion"));
    show(personA, "boveda");
    show(personA, "contador");
    expect(composerValue()).toBe("nota de la misma sesion");
  });

  test("atrás no revive un borrador que ya se purgó", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota que no debe volver"));
    show(personA, "boveda");
    const leave = [...host.querySelectorAll("button")].find((button) => button.textContent === "Salir");
    if (!leave) throw new Error("sin salir");
    act(() => leave.click());
    show(personA, "contador");
    expect(composerValue()).toBe("");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("sin compositor");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(box, "nota que no debe volver");
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(composerValue()).toBe("");
    expect(readComposerDraft(personA)).toBe("");
    expect(sessionStorage.getItem("brazo-draft-epoch") ?? "").not.toContain("nota");
    expect(localStorage.getItem("brazo-draft-epoch")).toBeNull();
  });

  test("una recarga alinea la purga y conserva un borrador nuevo", () => {
    purgeComposerDrafts();
    sessionStorage.setItem("brazo-draft-epoch", "40");
    alignComposerDraftEpoch();
    writeComposerDraft(personA, "nota nueva");
    expect(restoreComposerDraft(personA)).toBe("nota nueva");
  });

  test("una página restaurada no recupera el texto si otra ya lo purgó", () => {
    writeComposerDraft(personA, "nota congelada");
    sessionStorage.setItem("brazo-draft-epoch", "99");
    expect(restoreComposerDraft(personA)).toBe("");
    expect(readComposerDraft(personA)).toBe("");
    show(personA, "contador");
    const box = host.querySelector("textarea");
    if (!box) throw new Error("sin compositor");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
      setter?.call(box, "nota congelada");
      const shown = new PageTransitionEvent("pageshow");
      Object.defineProperty(shown, "persisted", { value: true });
      window.dispatchEvent(shown);
    });
    expect(composerValue()).toBe("");
    expect(readComposerDraft(personA)).toBe("");
  });

  test("remontar la misma persona tras una purga externa no devuelve el borrador", () => {
    show(personA, "contador");
    act(() => setComposer(host, "nota que otro documento purgó"));
    expect(composerValue()).toBe("nota que otro documento purgó");
    act(() => root.unmount());
    host.remove();
    sessionStorage.setItem("brazo-draft-epoch", "9001");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    show(personA, "contador");
    expect(composerValue()).toBe("");
    expect(readComposerDraft(personA)).toBe("");
    expect(sessionStorage.getItem("brazo-draft-epoch")).toBe("9001");
    expect(sessionStorage.getItem("brazo-draft-epoch")).not.toContain("nota");
    expect(localStorage.getItem("brazo-draft-epoch")).toBeNull();
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
