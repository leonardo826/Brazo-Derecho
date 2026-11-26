import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { browsePublic } from "../src/browser.mjs";
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

test("el instalador deja cada perfil en 0700 para iabot y systemd puede escribirlo", () => {
  const install = readFileSync(new URL("../install-ubuntu-24.04.sh", import.meta.url), "utf8");
  const unit = readFileSync(new URL("../systemd/iabot-machine-agent.service", import.meta.url), "utf8");
  assert.match(install, /install -d -o iabot -g iabot -m 0700 \/var\/lib\/iabot\/profiles/);
  for (const kind of ["ACCOUNTING", "MARKETING", "WHATSAPP"]) {
    assert.match(install, new RegExp(`install -d -o iabot -g iabot -m 0700 /var/lib/iabot/profiles/${kind}`));
  }
  assert.match(unit, /ReadWritePaths=.*\/var\/lib\/iabot(?:\s|$)/);
  const apparmor = readFileSync(new URL("../apparmor/iabot-chromium", import.meta.url), "utf8");
  assert.match(apparmor, /profile iabot-chromium /);
  assert.match(apparmor, /chrome-headless-shell/);
  assert.match(apparmor, /userns/);
});
