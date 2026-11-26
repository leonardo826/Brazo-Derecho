import { lookup } from "node:dns/promises";
import { lstat, mkdir, readFile, readlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { startGuardProxy } from "./guard-proxy.mjs";
import { ensureProfileDir, profileDirFor } from "./profiles.mjs";
import { isIpAddress, isPrivateAddress, publicUrl } from "./protocol.mjs";

export const LAUNCH_TIMEOUT_MS = 15_000;

const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

export const SECURITY_ARGS = [
  "--disable-dev-shm-usage",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  "--hide-crash-restore-bubble",
  "--disable-save-password-bubble",
  "--disable-features=InfiniteSessionRestore,PasswordManagerOnboarding,AutofillServerCommunication",
];

const PROFILE_PREFS = {
  session: { restore_on_startup: 5 },
  profile: { password_manager_enabled: false, exit_type: "Normal", exited_cleanly: true },
  credentials_enable_service: false,
  autofill: { enabled: false, profile_enabled: false, credit_card_enabled: false },
};

function abortError() {
  return Object.assign(new Error("abort"), { name: "AbortError" });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function clearStaleSingleton(profileDir) {
  const lockPath = path.join(profileDir, "SingletonLock");
  let info;
  try {
    info = await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isSymbolicLink()) return false;
  const target = await readlink(lockPath);
  const match = /-(\d+)$/.exec(target);
  const pid = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(pid) || pid <= 0 || pidAlive(pid)) return false;
  for (const name of LOCK_FILES) {
    await unlink(path.join(profileDir, name)).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return true;
}

async function directoryOrCreate(dir) {
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("agente");
    return;
  } catch (error) {
    if (error instanceof Error && error.message === "agente") throw error;
    if (error?.code !== "ENOENT") throw new Error("agente");
  }
  await mkdir(dir, { mode: 0o700 });
  const created = await lstat(dir);
  if (created.isSymbolicLink() || !created.isDirectory()) throw new Error("agente");
}

export async function writeProfilePrefs(profileDir) {
  const prefsDir = path.join(profileDir, "Default");
  await directoryOrCreate(prefsDir);
  const file = path.join(prefsDir, "Preferences");
  let current = {};
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error("agente");
    current = JSON.parse(await readFile(file, "utf8"));
    if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
  } catch (error) {
    if (error instanceof Error && error.message === "agente") throw error;
    if (error?.code !== "ENOENT") current = {};
  }
  const next = {
    ...current,
    session: { ...(current.session && typeof current.session === "object" ? current.session : {}), ...PROFILE_PREFS.session },
    profile: { ...(current.profile && typeof current.profile === "object" ? current.profile : {}), ...PROFILE_PREFS.profile },
    credentials_enable_service: false,
    autofill: { ...(current.autofill && typeof current.autofill === "object" ? current.autofill : {}), ...PROFILE_PREFS.autofill },
  };
  await writeFile(file, JSON.stringify(next), { mode: 0o600 });
  return file;
}

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

async function launchPersistent(profileDir, launchOptions) {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, {
    headless: true,
    proxy: launchOptions.proxy,
    args: launchOptions.args,
    timeout: launchOptions.timeout,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

export async function launchBound(launch, profileDir, launchOptions, signal) {
  const pending = Promise.resolve().then(() => launch(profileDir, launchOptions));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), launchOptions.timeout);
  });
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
  try {
    return await Promise.race([pending, timeout, aborted]);
  } catch (error) {
    pending.then((context) => context?.close?.()).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function freshPage(context) {
  const page = await context.newPage();
  const open = typeof context.pages === "function" ? context.pages() : [];
  for (const extra of open) {
    if (extra !== page) await extra.close().catch(() => undefined);
  }
  return page;
}

export async function browsePublic(raw, signal, lookupImpl, options = {}) {
  const url = await navigationAllowed(raw, lookupImpl);
  if (!url) throw new Error("destino");
  const identity = options.organizationId
    ? { organizationId: options.organizationId, agentKind: options.agentKind }
    : options.agentKind;
  const profileDir = profileDirFor(identity, options.root);
  if (options.profileDir !== undefined && options.profileDir !== profileDir) throw new Error("agente");
  await ensureProfileDir(profileDir, options.root);
  await clearStaleSingleton(profileDir);
  await writeProfilePrefs(profileDir);
  const proxy = startGuardProxy({ lookup: lookupImpl });
  const launch = options.launch ?? launchPersistent;
  const timeout = options.timeoutMs ?? LAUNCH_TIMEOUT_MS;
  try {
    const port = await proxy.listen();
    const launchOptions = {
      proxy: { server: `http://127.0.0.1:${port}` },
      args: SECURITY_ARGS,
      timeout,
    };
    const context = await launchBound(launch, profileDir, launchOptions, signal);
    try {
      const page = await freshPage(context);
      const abort = () => {
        void context.close().catch(() => undefined);
      };
      if (signal?.aborted) throw abortError();
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
