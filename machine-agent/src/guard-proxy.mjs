import { lookup } from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import { isIpAddress, isPrivateAddress } from "./protocol.mjs";

const defaultLookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function resolvePublic(host, lookupImpl = defaultLookup) {
  const name = String(host ?? "").trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!name) return null;
  if (isIpAddress(name)) return isPrivateAddress(name) ? null : name;
  let records;
  try {
    records = await lookupImpl(name);
  } catch {
    return null;
  }
  if (!records?.length || records.some((record) => !record?.address || isPrivateAddress(record.address))) return null;
  const pin = records[0].address;
  if (!pin || isPrivateAddress(pin)) return null;
  return pin;
}

function defaultConnect(address, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port, family: address.includes(":") ? 6 : 4 });
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });
}

export function parseConnectTarget(raw) {
  const match = /^(.+):(\d+)$/.exec(String(raw ?? "").trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (port !== 443) return null;
  const host = match[1].replace(/^\[|\]$/g, "");
  if (!host) return null;
  return { host, port };
}

function tieSockets(clientSocket, upstream) {
  let closed = false;
  const fail = () => {
    if (closed) return;
    closed = true;
    if (upstream && !upstream.destroyed) upstream.destroy();
    if (!clientSocket.destroyed) clientSocket.destroy();
  };
  clientSocket.on("error", fail);
  upstream.on("error", fail);
  upstream.pipe(clientSocket);
  clientSocket.pipe(upstream);
  return fail;
}

export function startGuardProxy(options = {}) {
  const lookupImpl = options.lookup ?? defaultLookup;
  const connectImpl = options.connect ?? defaultConnect;
  const server = http.createServer((_req, res) => {
    res.on("error", () => {
      res.destroy();
    });
    if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("solo https");
  });
  server.on("connect", (req, clientSocket) => {
    let upstream = null;
    let closed = false;
    const fail = () => {
      if (closed) return;
      closed = true;
      if (upstream && !upstream.destroyed) upstream.destroy();
      if (!clientSocket.destroyed) clientSocket.destroy();
    };
    clientSocket.on("error", fail);
    void (async () => {
      const target = parseConnectTarget(req.url);
      const pin = target ? await resolvePublic(target.host, lookupImpl) : null;
      if (!target || !pin) {
        if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      upstream = await connectImpl(pin, 443);
      tieSockets(clientSocket, upstream);
      if (!clientSocket.destroyed) clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    })().catch(() => {
      fail();
    });
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });
  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
