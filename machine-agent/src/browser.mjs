import { lookup } from "node:dns/promises";
import { startGuardProxy } from "./guard-proxy.mjs";
import { ensureProfileDir, profileDirFor } from "./profiles.mjs";
import { isIpAddress, isPrivateAddress, publicUrl } from "./protocol.mjs";

const SECURITY_ARGS = [
  "--disable-dev-shm-usage",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
];

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

async function launchPersistent(profileDir, { proxy, args }) {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, {
    headless: true,
    proxy,
    args,
  });
}

export async function browsePublic(raw, signal, lookupImpl, options = {}) {
  const url = await navigationAllowed(raw, lookupImpl);
  if (!url) throw new Error("destino");
  const identity = options.organizationId
    ? { organizationId: options.organizationId, agentKind: options.agentKind }
    : options.agentKind;
  const profileDir = profileDirFor(identity, options.root);
  if (options.profileDir !== undefined && options.profileDir !== profileDir) throw new Error("agente");
  await ensureProfileDir(profileDir);
  const proxy = startGuardProxy({ lookup: lookupImpl });
  const launch = options.launch ?? launchPersistent;
  try {
    const port = await proxy.listen();
    const context = await launch(profileDir, {
      proxy: { server: `http://127.0.0.1:${port}` },
      args: SECURITY_ARGS,
    });
    try {
      const existing = typeof context.pages === "function" ? context.pages() : [];
      const page = existing[0] ?? (await context.newPage());
      const abort = () => {
        void context.close().catch(() => undefined);
      };
      if (signal?.aborted) throw Object.assign(new Error("abort"), { name: "AbortError" });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        const finalUrl = page.url();
        if (!(await navigationAllowed(finalUrl, lookupImpl))) throw new Error("destino");
        return { title: await page.title(), finalUrl, profileDir };
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await proxy.close();
  }
}
