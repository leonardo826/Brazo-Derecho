import { spawn } from "node:child_process";
import { xdotoolArgs } from "./actions.ts";
import type { DesktopAction } from "./actions.ts";
import { pickWorkWindow, type Desktop, type DesktopStatus } from "./desktop.ts";

export type CdpPage = {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
};

type FetchLike = typeof fetch;

export function pagesFromList(data: unknown): CdpPage[] {
  if (!Array.isArray(data)) return [];
  const pages: CdpPage[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "page" || typeof row.url !== "string" || typeof row.webSocketDebuggerUrl !== "string") continue;
    pages.push({
      id: typeof row.id === "string" ? row.id : "",
      type: "page",
      url: row.url,
      title: typeof row.title === "string" ? row.title : "",
      webSocketDebuggerUrl: row.webSocketDebuggerUrl,
    });
  }
  return pages;
}

export function pngFromCdpResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const data = (result as { data?: unknown }).data;
  if (typeof data !== "string" || !data) return null;
  return Buffer.from(data, "base64");
}

export async function listPages(cdpBase: string, fetchImpl: FetchLike = fetch) {
  const response = await fetchImpl(`${cdpBase.replace(/\/$/, "")}/json/list`);
  if (!response.ok) throw new Error("chromium_down");
  return pagesFromList(await response.json());
}

export async function ensureWhatsappTab(cdpBase: string, fetchImpl: FetchLike = fetch) {
  const pages = await listPages(cdpBase, fetchImpl);
  if (pages.some((page) => page.url.includes("web.whatsapp.com"))) return false;
  const url = `${cdpBase.replace(/\/$/, "")}/json/new?${encodeURIComponent("https://web.whatsapp.com/")}`;
  const put = await fetchImpl(url, { method: "PUT" });
  if (put.ok) return true;
  const get = await fetchImpl(url);
  if (!get.ok) throw new Error("whatsapp_tab");
  return true;
}

export async function waitForCdp(cdpBase: string, tries = 50) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(`${cdpBase.replace(/\/$/, "")}/json/version`);
      if (response.ok) return true;
    } catch {
      // Chromium todavía está partiendo.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function workPage(pages: CdpPage[]) {
  return pages.find((page) => !page.url.includes("web.whatsapp.com")) ?? null;
}

function cdpCall(wsUrl: string, method: string, params: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("cdp_timeout"));
    }, 10_000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.addEventListener("message", (event) => {
      const payload = typeof event.data === "string" ? event.data : "";
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(payload) as { id?: number; result?: unknown; error?: { message?: string } };
      } catch {
        return;
      }
      if (message.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error("cdp"));
      else resolve(message.result);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cdp"));
    });
  });
}

function run(bin: string, args: string[], display: string) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, DISPLAY: display } });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 4000) stdout = stdout.slice(0, 4000);
    });
    child.on("error", () => reject(new Error(`No pude ejecutar ${bin}`)));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function focusWorkWindow(display: string) {
  let search = await run("xdotool", ["search", "--class", "Chromium"], display);
  if (search.code !== 0 || !search.stdout.trim()) {
    search = await run("xdotool", ["search", "--class", "chromium"], display);
  }
  const ids = search.stdout.split(/\s+/).filter(Boolean);
  if (!ids.length) return;
  const windows: { id: string; name: string }[] = [];
  for (const id of ids) {
    const name = await run("xdotool", ["getwindowname", id], display);
    windows.push({ id, name: name.stdout.trim() });
  }
  const picked = pickWorkWindow(windows);
  if (!picked) return;
  await run("xdotool", ["windowactivate", "--sync", picked], display);
}

export function createCdpDesktop(options: { cdpBase: string; display: string; profileDir: string; fetchImpl?: FetchLike }): Desktop {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.cdpBase.replace(/\/$/, "");

  async function status(): Promise<DesktopStatus> {
    try {
      const pages = await listPages(base, fetchImpl);
      const whatsappTab = pages.some((page) => page.url.includes("web.whatsapp.com"));
      return {
        ok: pages.length > 0,
        display: options.display,
        chromium: pages.length > 0 ? "up" : "down",
        whatsappTab,
        profileDir: options.profileDir,
      };
    } catch {
      return { ok: false, display: options.display, chromium: "down", whatsappTab: false, profileDir: options.profileDir };
    }
  }

  return {
    status,
    async screenshot() {
      const pages = await listPages(base, fetchImpl);
      const page = workPage(pages) ?? pages[0];
      if (!page) throw new Error("sin_pagina");
      const result = await cdpCall(page.webSocketDebuggerUrl, "Page.captureScreenshot", { format: "png" });
      const png = pngFromCdpResult(result);
      if (!png?.length) throw new Error("sin_captura");
      return png;
    },
    async perform(action: DesktopAction) {
      if (action.type === "goto") {
        const pages = await listPages(base, fetchImpl);
        const page = workPage(pages);
        if (!page) {
          const created = await fetchImpl(`${base}/json/new?${encodeURIComponent(action.url)}`, { method: "PUT" });
          if (!created.ok) throw new Error("goto");
          return;
        }
        await cdpCall(page.webSocketDebuggerUrl, "Page.navigate", { url: action.url });
        return;
      }
      await focusWorkWindow(options.display);
      const result = await run("xdotool", xdotoolArgs(action), options.display);
      if (result.code !== 0) throw new Error("xdotool");
    },
  };
}
