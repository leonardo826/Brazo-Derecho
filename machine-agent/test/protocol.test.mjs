import assert from "node:assert/strict";
import test from "node:test";
import { closeBrowsers, rememberBrowser } from "../src/browser.mjs";
import { handshakeProof, isPrivateAddress, requestSignature } from "../src/protocol.mjs";
import { handleMachine, resetMachineTasks } from "../src/server.mjs";

const token = "lease-token-123456";
const machineId = "machine-1";
const domain = "vm.ejemplo.cl";

function signed(method, path, body, used = token) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = `n${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.slice(0, 32);
  const headers = {
    "x-iabot-timestamp": timestamp,
    "x-iabot-nonce": nonce,
    "x-iabot-host": domain,
    "x-iabot-signature": requestSignature(used, { timestamp, nonce, method, path, body: raw, host: domain }),
  };
  return { raw, headers };
}

function deps(extra = {}) {
  return {
    token,
    machineId,
    leaseEpoch: "1",
    domain,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    browse: async () => ({ title: "Example", finalUrl: "https://example.com/" }),
    perform: async () => undefined,
    ...extra,
  };
}

test("la prueba ata el host y una IP de documentación no es pública", () => {
  const proof = handshakeProof(token, "nonce-de-prueba-0001", machineId, domain);
  assert.equal(proof.includes(token), false);
  assert.notEqual(proof, handshakeProof(token, "nonce-de-prueba-0001", machineId, "otro.ejemplo.cl"));
  assert.equal(isPrivateAddress("192.88.99.1"), true);
  assert.equal(isPrivateAddress("2001:db8::1"), true);
  assert.equal(isPrivateAddress("2001::1"), true);
  assert.equal(isPrivateAddress("64:ff9b:1::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("sin época o con la época equivocada no hay acción", async () => {
  resetMachineTasks();
  const taskId = "task-machine-03";
  let performed = 0;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const openBody = { goal: "Abre https://example.com", machineId, taskId, epoch: 1 };
  const openSigned = signed("POST", "/task", openBody);
  const pending = handleMachine(
    { method: "POST", path: "/task", body: openBody, rawBody: openSigned.raw, headers: openSigned.headers },
    deps({
      browse: () => gate.then(() => ({ title: "Example", finalUrl: "https://example.com/" })),
      perform: async () => {
        performed += 1;
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const wrongBody = { type: "click", x: 1, y: 1, machineId, taskId, epoch: 9 };
  const wrongSigned = signed("POST", "/action", wrongBody);
  const wrong = await handleMachine(
    { method: "POST", path: "/action", body: wrongBody, rawBody: wrongSigned.raw, headers: wrongSigned.headers },
    deps(),
  );
  assert.equal(wrong.status, 409);
  const closed = { ...deps(), leaseEpoch: "" };
  const emptyBody = { type: "click", x: 1, y: 1, machineId, taskId, epoch: 1 };
  const emptySigned = signed("POST", "/action", emptyBody);
  const empty = await handleMachine(
    { method: "POST", path: "/action", body: emptyBody, rawBody: emptySigned.raw, headers: emptySigned.headers },
    closed,
  );
  assert.equal(empty.status, 409);
  const okBody = { type: "click", x: 1, y: 1, machineId, taskId, epoch: 1 };
  const okSigned = signed("POST", "/action", okBody);
  const ok = await handleMachine(
    { method: "POST", path: "/action", body: okBody, rawBody: okSigned.raw, headers: okSigned.headers },
    deps({
      perform: async () => {
        performed += 1;
      },
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal(performed, 1);
  release();
  const done = await pending;
  assert.equal(JSON.parse(done.body.toString("utf8")).status, "DONE");
});

test("el apretón exige firma y el token anterior sigue valiendo en la transición", async () => {
  resetMachineTasks();
  const body = { nonce: "nonce-de-prueba-0001", machineId, host: domain };
  const wire = signed("POST", "/handshake", body);
  const handshake = await handleMachine(
    { method: "POST", path: "/handshake", body, rawBody: wire.raw, headers: wire.headers },
    deps(),
  );
  const proof = JSON.parse(handshake.body.toString("utf8"));
  assert.equal(handshake.status, 200);
  assert.equal(proof.proof, handshakeProof(token, "nonce-de-prueba-0001", machineId, domain));
  assert.equal(handshake.body.toString("utf8").includes(token), false);
  assert.equal(proof.status, undefined);

  const previous = "lease-token-anterior";
  const oldBody = { goal: "Abre https://example.com", machineId, taskId: "task-machine-04", epoch: 1 };
  const oldWire = signed("POST", "/task", oldBody, previous);
  const accepted = await handleMachine(
    { method: "POST", path: "/task", body: oldBody, rawBody: oldWire.raw, headers: oldWire.headers },
    deps({ previousToken: previous }),
  );
  assert.equal(JSON.parse(accepted.body.toString("utf8")).status, "DONE");
  assert.equal(accepted.body.toString("utf8").includes(previous), false);
});

test("cerrar chromium espera a que no haya una tarea", async () => {
  resetMachineTasks();
  let closed = 0;
  const idleBody = { machineId, epoch: 1 };
  const idleWire = signed("POST", "/browser/close", idleBody);
  const idle = await handleMachine(
    { method: "POST", path: "/browser/close", body: idleBody, rawBody: idleWire.raw, headers: idleWire.headers },
    deps({
      closeBrowser: async () => {
        closed += 1;
      },
    }),
  );
  assert.equal(idle.status, 200);
  assert.equal(closed, 1);

  const unsigned = await handleMachine(
    { method: "POST", path: "/browser/close", body: idleBody, rawBody: JSON.stringify(idleBody), headers: {} },
    deps(),
  );
  assert.equal(unsigned.status, 401);

  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const taskId = "task-close-0001";
  const openBody = { goal: "Abre https://example.com", machineId, taskId, epoch: 1 };
  const openSigned = signed("POST", "/task", openBody);
  const pending = handleMachine(
    { method: "POST", path: "/task", body: openBody, rawBody: openSigned.raw, headers: openSigned.headers },
    deps({
      browse: () => gate.then(() => ({ title: "Example", finalUrl: "https://example.com/" })),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const busyBody = { machineId, epoch: 1 };
  const busyWire = signed("POST", "/browser/close", busyBody);
  const busy = await handleMachine(
    { method: "POST", path: "/browser/close", body: busyBody, rawBody: busyWire.raw, headers: busyWire.headers },
    deps({
      closeBrowser: async () => {
        closed += 1;
      },
    }),
  );
  assert.equal(busy.status, 409);
  assert.equal(JSON.parse(busy.body.toString("utf8")).error, "tarea");
  assert.equal(closed, 1);
  release();
  await pending;
});

test("el cierre del proceso cierra el chromium que quedó abierto", async () => {
  resetMachineTasks();
  let closed = 0;
  rememberBrowser({
    async close() {
      closed += 1;
    },
  });
  const body = { machineId, epoch: 1 };
  const wire = signed("POST", "/browser/close", body);
  const result = await handleMachine(
    { method: "POST", path: "/browser/close", body, rawBody: wire.raw, headers: wire.headers },
    deps({ closeBrowser: closeBrowsers }),
  );
  assert.equal(result.status, 200);
  assert.equal(closed, 1);
  assert.equal(JSON.parse(result.body.toString("utf8")).ok, true);
});
