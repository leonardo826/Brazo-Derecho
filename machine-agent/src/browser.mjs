import { lookup } from "node:dns/promises";
import { startGuardProxy } from "./guard-proxy.mjs";
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
  const proxy = startGuardProxy({ lookup: lookupImpl });
  const port = await proxy.listen();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: `http://127.0.0.1:${port}` },
    args: [
      "--disable-dev-shm-usage",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const abort = () => {
      void context.close().catch(() => undefined);
    };
    if (signal?.aborted) throw Object.assign(new Error("abort"), { name: "AbortError" });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const finalUrl = page.url();
      if (!(await navigationAllowed(finalUrl, lookupImpl))) throw new Error("destino");
      return { title: await page.title(), finalUrl };
    } finally {
      signal?.removeEventListener("abort", abort);
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser.close();
    await proxy.close();
  }
}
