import http from "node:http";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { resolvePublic, startGuardProxy } from "../src/guard-proxy.mjs";

function ask(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "GET", path }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

test("un salto a una IP privada o a loopback no abre conexión", async () => {
  assert.equal(await resolvePublic("169.254.169.254", async () => [{ address: "169.254.169.254" }]), null);
  assert.equal(await resolvePublic("127.0.0.1", async () => [{ address: "127.0.0.1" }]), null);
  assert.equal(await resolvePublic("rebinding.test", async () => [{ address: "10.0.0.8" }]), null);
  assert.equal(await resolvePublic("publico.test", async () => [{ address: "93.184.216.34" }, { address: "192.168.0.1" }]), null);
  assert.equal(await resolvePublic("publico.test", async () => [{ address: "93.184.216.34" }]), "93.184.216.34");

  const connects = [];
  const proxy = startGuardProxy({
    lookup: async (host) => {
      if (host === "publico.test") return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: host, family: 4 }];
    },
    connect: async (address, port) => {
      connects.push({ address, port });
      const socket = new PassThrough();
      setTimeout(() => socket.destroy(new Error("fin")), 15);
      return socket;
    },
  });
  const port = await proxy.listen();
  try {
    await ask(port, "http://publico.test/inicio");
    assert.deepEqual(connects, [{ address: "93.184.216.34", port: 80 }]);
    assert.equal(await ask(port, "http://169.254.169.254/latest"), 403);
    assert.equal(await ask(port, "http://127.0.0.1:8787/status"), 403);
    assert.equal(await ask(port, "http://10.1.2.3/interno"), 403);
    assert.equal(connects.length, 1);
  } finally {
    await proxy.close();
  }
});
