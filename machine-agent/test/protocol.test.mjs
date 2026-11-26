import assert from "node:assert/strict";
import test from "node:test";
import { handshakeProof, isPrivateAddress } from "../src/protocol.mjs";
import { handleMachine, resetMachineTasks } from "../src/server.mjs";

const token = "lease-token-123456";
const machineId = "machine-1";

test("la prueba no devuelve el token y una IP privada no es pública", () => {
  const proof = handshakeProof(token, "nonce-de-prueba-0001", machineId);
  assert.equal(proof.includes(token), false);
  assert.equal(isPrivateAddress("fe9a::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("el apretón, la tarea y la acción exigen la máquina y no filtran el token", async () => {
  resetMachineTasks();
  const deps = {
    token,
    machineId,
    leaseEpoch: "1",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    browse: async () => ({ title: "Example", finalUrl: "https://example.com/" }),
    perform: async () => undefined,
  };
  const handshake = await handleMachine(
    { method: "POST", path: "/handshake", body: { nonce: "nonce-de-prueba-0001", machineId } },
    deps,
  );
  const proof = JSON.parse(handshake.body.toString("utf8"));
  assert.equal(handshake.status, 200);
  assert.equal(proof.proof, handshakeProof(token, "nonce-de-prueba-0001", machineId));
  assert.equal(handshake.body.toString("utf8").includes(token), false);
  assert.equal(proof.status, undefined);

  const taskId = "task-machine-01";
  const early = await handleMachine(
    {
      method: "POST",
      path: "/task/cancel",
      body: { machineId, taskId, epoch: 1 },
      headers: { authorization: `Bearer ${token}` },
    },
    deps,
  );
  assert.equal(early.status, 200);
  const blocked = await handleMachine(
    {
      method: "POST",
      path: "/task",
      body: { goal: "Abre https://example.com", machineId, taskId, epoch: 1 },
      headers: { authorization: `Bearer ${token}` },
    },
    deps,
  );
  assert.equal(JSON.parse(blocked.body.toString("utf8")).status, "FAILED");

  let browsed = 0;
  const open = await handleMachine(
    {
      method: "POST",
      path: "/task",
      body: { goal: "Abre https://example.com", machineId, taskId: "task-machine-02", epoch: 1 },
      headers: { authorization: `Bearer ${token}` },
    },
    { ...deps, browse: async () => { browsed += 1; return { title: "Example", finalUrl: "https://example.com/" }; } },
  );
  const done = JSON.parse(open.body.toString("utf8"));
  assert.equal(done.status, "DONE");
  assert.equal(done.xaiMode, "live");
  assert.equal(done.result.includes("example.com"), true);
  assert.equal(open.body.toString("utf8").includes(token), false);
  assert.equal(browsed, 1);

  const denied = await handleMachine(
    {
      method: "POST",
      path: "/action",
      body: { type: "click", x: 1, y: 1, machineId },
      headers: { authorization: `Bearer ${token}` },
    },
    deps,
  );
  assert.equal(denied.status, 403);
});
