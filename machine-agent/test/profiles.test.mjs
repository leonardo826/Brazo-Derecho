import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { lstat, mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { browsePublic, clearStaleSingleton, LAUNCH_TIMEOUT_MS, SECURITY_ARGS } from "../src/browser.mjs";
import { createProfileGate, profileDirFor, PROFILE_ROOT } from "../src/profiles.mjs";
import { requestSignature } from "../src/protocol.mjs";
import { handleMachine, resetMachineTasks } from "../src/server.mjs";

const token = "lease-token-123456";
const machineId = "machine-1";
const domain = "vm.ejemplo.cl";
const org = "org-a";

function signed(method, pathName, body, used = token) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `n${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.slice(0, 32);
  const headers = {
    "x-iabot-timestamp": timestamp,
    "x-iabot-nonce": nonce,
    "x-iabot-host": domain,
    "x-iabot-signature": requestSignature(used, { timestamp, nonce, method, path: pathName, body: raw, host: domain }),
  };
  return { raw, headers };
}

function machine(extra = {}) {
  return {
    token,
    machineId,
    leaseEpoch: "1",
    domain,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    browse: async () => ({ title: "Example", finalUrl: "https://example.com/" }),
    ...extra,
  };
}

test("el perfil es el agente, y dos agentes de la misma empresa no comparten directorio", () => {
  const accounting = profileDirFor({ organizationId: org, agentKind: "ACCOUNTING" });
  const marketing = profileDirFor({ organizationId: org, agentKind: "MARKETING" });
  const whatsapp = profileDirFor({ organizationId: org, agentKind: "WHATSAPP" });
  assert.equal(accounting, path.join(PROFILE_ROOT, "ACCOUNTING"));
  assert.equal(marketing, path.join(PROFILE_ROOT, "MARKETING"));
  assert.equal(whatsapp, path.join(PROFILE_ROOT, "WHATSAPP"));
  assert.notEqual(accounting, marketing);
  assert.notEqual(marketing, whatsapp);
  assert.equal(accounting.includes(org), false);
  assert.equal(profileDirFor({ organizationId: "org-b", agentKind: "ACCOUNTING" }), accounting);
  for (const agentKind of ["../ACCOUNTING", "..", "ACCOUNTING/../MARKETING", "ACCOUNTING/WHATSAPP", "/etc/passwd", "QUOTES", "accounting", " ACCOUNTING", ""]) {
    assert.throws(() => profileDirFor({ organizationId: org, agentKind }), /agente/);
  }
  assert.throws(() => profileDirFor({ organizationId: "../../etc", agentKind: "ACCOUNTING" }), /agente/);
  assert.throws(() => profileDirFor({ organizationId: "org/a", agentKind: "MARKETING" }), /agente/);
});

test("agentKind entra en la firma y un cuerpo alterado no se acepta", async () => {
  const base = { goal: "Abre https://example.com", machineId, taskId: "task-profile-sign", epoch: 1 };
  const stamp = { timestamp: "1700000000", nonce: "nonce-de-perfil-0001", method: "POST", path: "/task", host: domain };
  const accounting = requestSignature(token, { ...stamp, body: JSON.stringify({ ...base, agentKind: "ACCOUNTING" }) });
  const marketing = requestSignature(token, { ...stamp, body: JSON.stringify({ ...base, agentKind: "MARKETING" }) });
  assert.notEqual(accounting, marketing);

  resetMachineTasks();
  const body = { ...base, taskId: "task-profile-signed", agentKind: "WHATSAPP" };
  const wire = signed("POST", "/task", body);
  const altered = wire.raw.replace("WHATSAPP", "MARKETING");
  const rejected = await handleMachine(
    { method: "POST", path: "/task", body: JSON.parse(altered), rawBody: altered, headers: wire.headers },
    machine(),
  );
  assert.equal(rejected.status, 401);

  const dirs = [];
  const accepted = await handleMachine(
    { method: "POST", path: "/task", body: { ...body, agentKind: "ACCOUNTING" }, rawBody: wire.raw, headers: wire.headers },
    machine({
      browse: async (_url, _signal, _lookup, options) => {
        dirs.push(options.profileDir);
        return { title: "Example", finalUrl: "https://example.com/" };
      },
    }),
  );
  assert.equal(JSON.parse(accepted.body.toString("utf8")).status, "DONE");
  assert.deepEqual(dirs, [path.join(PROFILE_ROOT, "WHATSAPP")]);
});

test("un agentKind fuera de la lista no abre el navegador", async () => {
  resetMachineTasks();
  let browsed = 0;
  const body = { goal: "Abre https://example.com", machineId, taskId: "task-profile-bad", epoch: 1, agentKind: "../etc" };
  const wire = signed("POST", "/task", body);
  const response = await handleMachine(
    { method: "POST", path: "/task", body, rawBody: wire.raw, headers: wire.headers },
    machine({
      browse: async () => {
        browsed += 1;
        return { title: "Example", finalUrl: "https://example.com/" };
      },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(response.body.toString("utf8")).error, "agente");
  assert.equal(browsed, 0);
});

test("el mismo perfil espera y otro agente corre hasta el cupo", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iabot-gate-"));
  const gate = createProfileGate({ cap: 2, root });
  const started = [];
  let active = 0;
  let max = 0;
  const release = {};
  const hold = (kind) => new Promise((resolve) => {
    release[kind] = resolve;
  });
  const work = (kind) => gate.run({ organizationId: org, agentKind: kind }, async (dir) => {
    active += 1;
    max = Math.max(max, active);
    started.push({ kind, dir });
    await hold(kind);
    active -= 1;
    return dir;
  });
  const accounting = work("ACCOUNTING");
  const marketing = work("MARKETING");
  const whatsapp = work("WHATSAPP");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(started.map((item) => item.kind).sort(), ["ACCOUNTING", "MARKETING"]);
  assert.notEqual(started[0].dir, started[1].dir);
  assert.equal(started[0].dir, profileDirFor({ organizationId: org, agentKind: started[0].kind }, root));
  release.ACCOUNTING();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started.some((item) => item.kind === "WHATSAPP"), true);
  assert.equal(max, 2);
  release.MARKETING();
  release.WHATSAPP();
  const dirs = await Promise.all([accounting, marketing, whatsapp]);
  assert.equal(new Set(dirs).size, 3);

  const order = [];
  let finishFirst;
  const first = gate.run("ACCOUNTING", async () => {
    order.push("primero");
    await new Promise((resolve) => {
      finishFirst = resolve;
    });
    order.push("primero-fin");
  });
  const second = gate.run("ACCOUNTING", async () => {
    order.push("segundo");
  });
  const other = gate.run("MARKETING", async () => {
    order.push("otro");
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(order.includes("segundo"), false);
  assert.equal(order.includes("otro"), true);
  finishFirst();
  await Promise.all([first, second, other]);
  assert.deepEqual(order.filter((item) => item.startsWith("primero") || item === "segundo"), ["primero", "primero-fin", "segundo"]);
  await rm(root, { recursive: true, force: true });
});

test("la tarea usa el perfil persistente del agente y no un contexto suelto", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iabot-profile-"));
  const seen = [];
  const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  const launch = async (dir, options) => {
    seen.push({ dir, proxy: options.proxy.server, args: options.args });
    return {
      pages() {
        return [];
      },
      async newPage() {
        return {
          async goto(target) {
            assert.equal(target, "https://example.com/");
          },
          url: () => "https://example.com/",
          async title() {
            return "Example";
          },
        };
      },
      newContext() {
        throw new Error("contexto global");
      },
      async close() {},
    };
  };
  try {
    const accounting = await browsePublic("Abre https://example.com/", undefined, lookupImpl, {
      organizationId: org,
      agentKind: "ACCOUNTING",
      root,
      launch,
    });
    const marketing = await browsePublic("Abre https://example.com/", undefined, lookupImpl, {
      organizationId: org,
      agentKind: "MARKETING",
      root,
      launch,
    });
    assert.equal(accounting.profileDir, path.join(root, "ACCOUNTING"));
    assert.equal(marketing.profileDir, path.join(root, "MARKETING"));
    assert.notEqual(accounting.profileDir, marketing.profileDir);
    assert.equal((await stat(accounting.profileDir)).mode & 0o777, 0o700);
    assert.equal((await stat(marketing.profileDir)).mode & 0o777, 0o700);
    assert.match(seen[0].proxy, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(seen[0].args.includes("--disable-dev-shm-usage"), true);
    assert.equal(seen[0].args.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"), true);
    const source = readFileSync(new URL("../src/browser.mjs", import.meta.url), "utf8");
    assert.equal(source.includes("newContext("), false);
    assert.equal(source.includes("launchPersistentContext"), true);
    await assert.rejects(
      browsePublic("Abre https://example.com/", undefined, lookupImpl, { agentKind: "../WHATSAPP", root, launch }),
      /agente/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dos tareas del mismo agente no se solapan y las de otro agente sí", async () => {
  resetMachineTasks();
  const root = await mkdtemp(path.join(tmpdir(), "iabot-server-"));
  const gate = createProfileGate({ cap: 3, root });
  const events = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const browse = async (_url, _signal, _lookup, options) => {
    events.push(`abre:${options.agentKind}`);
    if (options.agentKind === "ACCOUNTING" && events.filter((item) => item === "abre:ACCOUNTING").length === 1) await held;
    events.push(`cierra:${options.agentKind}`);
    return { title: "Example", finalUrl: "https://example.com/" };
  };
  const deps = machine({ browse, gate, profileRoot: root });
  const firstBody = { goal: "Abre https://example.com", machineId, taskId: "task-profile-a1", epoch: 1, agentKind: "ACCOUNTING" };
  const firstWire = signed("POST", "/task", firstBody);
  const first = handleMachine(
    { method: "POST", path: "/task", body: firstBody, rawBody: firstWire.raw, headers: firstWire.headers },
    deps,
  );
  const secondBody = { goal: "Abre https://example.com", machineId, taskId: "task-profile-a2", epoch: 1, agentKind: "ACCOUNTING" };
  const secondWire = signed("POST", "/task", secondBody);
  const second = handleMachine(
    { method: "POST", path: "/task", body: secondBody, rawBody: secondWire.raw, headers: secondWire.headers },
    deps,
  );
  const otherBody = { goal: "Abre https://example.com", machineId, taskId: "task-profile-m1", epoch: 1, agentKind: "MARKETING" };
  const otherWire = signed("POST", "/task", otherBody);
  const other = handleMachine(
    { method: "POST", path: "/task", body: otherBody, rawBody: otherWire.raw, headers: otherWire.headers },
    deps,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(events, ["abre:ACCOUNTING", "abre:MARKETING", "cierra:MARKETING"]);
  release();
  const done = await Promise.all([first, second, other]);
  assert.equal(done.every((item) => JSON.parse(item.body.toString("utf8")).status === "DONE"), true);
  assert.deepEqual(events, ["abre:ACCOUNTING", "abre:MARKETING", "cierra:MARKETING", "cierra:ACCOUNTING", "abre:ACCOUNTING", "cierra:ACCOUNTING"]);
  await rm(root, { recursive: true, force: true });
});

test("el instalador deja los directorios padre a root y solo el perfil a iabot", () => {
  const install = readFileSync(new URL("../install-ubuntu-24.04.sh", import.meta.url), "utf8");
  const unit = readFileSync(new URL("../systemd/iabot-machine-agent.service", import.meta.url), "utf8");
  assert.match(install, /^install -d -o root -g iabot -m 0750 \/var\/lib\/iabot$/m);
  assert.match(install, /^install -d -o root -g iabot -m 0750 \/var\/lib\/iabot\/profiles$/m);
  for (const kind of ["ACCOUNTING", "MARKETING", "WHATSAPP"]) {
    assert.match(install, new RegExp(`^install -d -o iabot -g iabot -m 0700 /var/lib/iabot/profiles/${kind}$`, "m"));
    assert.match(unit, new RegExp(`/var/lib/iabot/profiles/${kind}`));
  }
  assert.equal(/ReadWritePaths=.*\/var\/lib\/iabot(?:\s|$)/.test(unit), false);
  const apparmor = readFileSync(new URL("../apparmor/iabot-chromium", import.meta.url), "utf8");
  assert.match(apparmor, /profile iabot-chromium /);
  assert.match(apparmor, /chrome-headless-shell/);
  assert.match(apparmor, /userns/);
});

async function deadPid() {
  for (let pid = 1_000_000; pid < 1_000_200; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return pid;
    }
  }
  throw new Error("sin pid libre");
}

test("un enlace plantado no abre Chromium", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "iabot-link-"));
  const root = path.join(parent, "profiles");
  const outside = path.join(parent, "fuera");
  await mkdir(root);
  await mkdir(outside);
  await symlink(outside, path.join(root, "ACCOUNTING"));
  let launched = 0;
  try {
    await assert.rejects(
      browsePublic("Abre https://example.com/", undefined, async () => [{ address: "93.184.216.34", family: 4 }], {
        organizationId: org,
        agentKind: "ACCOUNTING",
        root,
        launch: async () => {
          launched += 1;
          throw new Error("no");
        },
      }),
      /agente/,
    );
    assert.equal(launched, 0);
    assert.equal((await lstat(path.join(root, "ACCOUNTING"))).isSymbolicLink(), true);
    const linkedRoot = path.join(parent, "raiz-enlace");
    symlinkSync(root, linkedRoot);
    await assert.rejects(
      browsePublic("Abre https://example.com/", undefined, async () => [{ address: "93.184.216.34", family: 4 }], {
        agentKind: "MARKETING",
        root: linkedRoot,
        launch: async () => {
          launched += 1;
          throw new Error("no");
        },
      }),
      /agente/,
    );
    assert.equal(launched, 0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("el arranque tiene tope, el abort cierra Chromium y un candado viejo se quita", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iabot-lock-"));
  const profile = path.join(root, "WHATSAPP");
  await mkdir(profile);
  const dead = await deadPid();
  await symlink(`caja-${dead}`, path.join(profile, "SingletonLock"));
  await writeFile(path.join(profile, "SingletonSocket"), "");
  await writeFile(path.join(profile, "SingletonCookie"), "");
  assert.equal(await clearStaleSingleton(profile), true);
  assert.equal(await lstat(path.join(profile, "SingletonLock")).catch((error) => error.code), "ENOENT");

  await symlink(`caja-${process.pid}`, path.join(profile, "SingletonLock"));
  assert.equal(await clearStaleSingleton(profile), false);
  assert.equal((await lstat(path.join(profile, "SingletonLock"))).isSymbolicLink(), true);
  await rm(path.join(profile, "SingletonLock"));

  const seen = [];
  const stale = { closed: false, async close() { this.closed = true; }, async goto() { throw new Error("pagina vieja"); }, url: () => "about:blank", async title() { return "vieja"; } };
  const fresh = { async goto() {}, url: () => "https://example.com/", async title() { return "Example"; } };
  const launch = async (_dir, options) => {
    seen.push(options);
    return {
      pages: () => [stale],
      async newPage() {
        return fresh;
      },
      async close() {},
    };
  };
  try {
    const opened = await browsePublic("Abre https://example.com/", undefined, async () => [{ address: "93.184.216.34", family: 4 }], {
      agentKind: "WHATSAPP",
      root,
      launch,
    });
    assert.equal(opened.title, "Example");
    assert.equal(stale.closed, true);
    assert.equal(seen[0].timeout, LAUNCH_TIMEOUT_MS);
    for (const flag of ["--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--disable-save-password-bubble"]) {
      assert.equal(seen[0].args.includes(flag), true);
    }
    assert.equal(SECURITY_ARGS.includes("--force-webrtc-ip-handling-policy=disable_non_proxied_udp"), true);
    const prefs = JSON.parse(readFileSync(path.join(profile, "Default", "Preferences"), "utf8"));
    assert.equal(prefs.session.restore_on_startup, 5);
    assert.equal(prefs.profile.password_manager_enabled, false);
    assert.equal(prefs.credentials_enable_service, false);
    assert.equal(prefs.autofill.enabled, false);

    let closed = false;
    const controller = new AbortController();
    let finishLaunch;
    const hanging = new Promise((resolve) => {
      finishLaunch = () => resolve({
        pages: () => [],
        async newPage() {
          return fresh;
        },
        async close() {
          closed = true;
        },
      });
    });
    const pending = browsePublic("Abre https://example.com/", controller.signal, async () => [{ address: "93.184.216.34", family: 4 }], {
      agentKind: "WHATSAPP",
      root,
      timeoutMs: 5_000,
      launch: () => hanging,
    });
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AbortError");
    finishLaunch();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("la cola del perfil tiene tope y una espera larga responde ocupado", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iabot-cola-"));
  const gate = createProfileGate({ cap: 1, root, queueCap: 1, waitMs: 40 });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const run = (kind) => gate.run(kind, async () => {
    await held;
    return kind;
  });
  const first = run("ACCOUNTING");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = run("ACCOUNTING");
  assert.throws(() => run("ACCOUNTING"), (error) => error.status === 429);
  await assert.rejects(second, (error) => error.status === 503);
  release();
  assert.equal(await first, "ACCOUNTING");
  await rm(root, { recursive: true, force: true });
});

test("una tarea en cola demasiado tiempo no abre el navegador y la máquina responde 503", async () => {
  resetMachineTasks();
  const root = await mkdtemp(path.join(tmpdir(), "iabot-http-"));
  const gate = createProfileGate({ cap: 1, root, queueCap: 2, waitMs: 30 });
  let opened = 0;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const browse = async () => {
    opened += 1;
    if (opened === 1) await held;
    return { title: "Example", finalUrl: "https://example.com/" };
  };
  const deps = machine({ browse, gate, profileRoot: root });
  const firstBody = { goal: "Abre https://example.com", machineId, taskId: "task-cola-1", epoch: 1, agentKind: "ACCOUNTING" };
  const firstWire = signed("POST", "/task", firstBody);
  const first = handleMachine(
    { method: "POST", path: "/task", body: firstBody, rawBody: firstWire.raw, headers: firstWire.headers },
    deps,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondBody = { goal: "Abre https://example.com", machineId, taskId: "task-cola-2", epoch: 1, agentKind: "ACCOUNTING" };
  const secondWire = signed("POST", "/task", secondBody);
  const second = await handleMachine(
    { method: "POST", path: "/task", body: secondBody, rawBody: secondWire.raw, headers: secondWire.headers },
    deps,
  );
  assert.equal(second.status, 503);
  assert.equal(JSON.parse(second.body.toString("utf8")).error, "ocupado");
  release();
  assert.equal(JSON.parse((await first).body.toString("utf8")).status, "DONE");
  assert.equal(opened, 1);
  await rm(root, { recursive: true, force: true });
});
