import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";
import test from "node:test";
import { parseConnectTarget, resolvePublic, startGuardProxy } from "../src/guard-proxy.mjs";

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

function connectRequest(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let buf = "";
    const finish = () => resolve({ socket, status: buf || "closed" });
    socket.on("error", (error) => {
      if (buf) finish();
      else reject(error);
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\r\n\r\n")) finish();
    });
    socket.on("close", () => {
      if (buf) finish();
    });
    socket.on("connect", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
  });
}

test("http plano falla limpio y CONNECT solo acepta el 443 público", async () => {
  assert.equal(parseConnectTarget("example.com:80"), null);
  assert.deepEqual(parseConnectTarget("example.com:443"), { host: "example.com", port: 443 });
  assert.equal(await resolvePublic("169.254.169.254", async () => [{ address: "169.254.169.254" }]), null);
  assert.equal(await resolvePublic("publico.test", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }]), null);

  const connects = [];
  const proxy = startGuardProxy({
    lookup: async (host) => [{ address: host === "publico.test" ? "93.184.216.34" : host, family: 4 }],
    connect: async (address, port) => {
      connects.push({ address, port });
      return new Duplex({ read() {}, write(_chunk, _enc, cb) { cb(); } });
    },
  });
  const port = await proxy.listen();
  try {
    assert.equal(await ask(port, "http://publico.test/inicio"), 400);
    assert.equal(await ask(port, "http://169.254.169.254/latest"), 400);
    assert.equal(await ask(port, "http://127.0.0.1:8787/status"), 400);
    const denied = await connectRequest(port, "publico.test:80");
    assert.match(denied.status, /403/);
    denied.socket.destroy();
    const allowed = await connectRequest(port, "publico.test:443");
    assert.match(allowed.status, /200/);
    allowed.socket.destroy();
    assert.deepEqual(connects, [{ address: "93.184.216.34", port: 443 }]);
  } finally {
    await proxy.close();
  }
});

test("un RST en el túnel no tumba el proceso", async () => {
  const crashes = [];
  const onCrash = (error) => crashes.push(error?.code || error?.name || "error");
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  let upstream;
  const proxy = startGuardProxy({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    connect: async () => {
      upstream = new Duplex({ read() {}, write(_chunk, _enc, cb) { cb(); } });
      return upstream;
    },
  });
  const port = await proxy.listen();
  try {
    const opened = await connectRequest(port, "example.com:443");
    assert.match(opened.status, /200/);
    upstream.destroy(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(crashes, []);
    const next = await connectRequest(port, "10.0.0.8:443");
    assert.match(next.status, /403/);
    next.socket.destroy();
    opened.socket.destroy();
  } finally {
    process.off("uncaughtException", onCrash);
    process.off("unhandledRejection", onCrash);
    await proxy.close();
  }
});
