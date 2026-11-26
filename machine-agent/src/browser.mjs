import { lookup } from "node:dns/promises";
import { isIpAddress, isPrivateAddress, publicUrl } from "./protocol.mjs";

async function hostAllowed(hostname, lookupImpl) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isIpAddress(host)) return !isPrivateAddress(host);
  const records = await lookupImpl(host);
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) return false;
  return true;
}

export async function navigationAllowed(raw, lookupImpl = (hostname) => lookup(hostname, { all: true, verbatim: true })) {
  const url = publicUrl(raw);
  if (!url) return null;
  const parsed = new URL(url);
  if (!(await hostAllowed(parsed.hostname, lookupImpl))) return null;
  return parsed.toString();
}

export async function browsePublic(raw, signal, lookupImpl) {
  const url = await navigationAllowed(raw, lookupImpl);
  if (!url) throw new Error("destino");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const abort = () => {
      void context.close().catch(() => undefined);
    };
    if (signal?.aborted) throw Object.assign(new Error("abort"), { name: "AbortError" });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await page.route("**/*", async (route) => {
        const allowed = await navigationAllowed(route.request().url(), lookupImpl).catch(() => null);
        if (!allowed) {
          await route.abort();
          return;
        }
        await route.continue();
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      return { title: await page.title(), finalUrl: page.url() };
    } finally {
      signal?.removeEventListener("abort", abort);
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
}
