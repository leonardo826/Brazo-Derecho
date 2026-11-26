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

async function openTarget(rawUrl, lookupImpl, connectImpl) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  const pin = await resolvePublic(target.hostname, lookupImpl);
  if (!pin) return null;
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const socket = await connectImpl(pin, port);
  return { target, pin, port, socket };
}

export function startGuardProxy(options = {}) {
  const lookupImpl = options.lookup ?? defaultLookup;
  const connectImpl = options.connect ?? defaultConnect;
  const server = http.createServer((req, res) => {
    void (async () => {
      const opened = await openTarget(req.url ?? "", lookupImpl, connectImpl);
      if (!opened) {
        res.writeHead(403);
        res.end();
        return;
      }
      const path = `${opened.target.pathname}${opened.target.search}` || "/";
      opened.socket.write(`${req.method} ${path} HTTP/1.1\r\nHost: ${opened.target.host}\r\nConnection: close\r\n\r\n`);
      opened.socket.pipe(res);
      opened.socket.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  server.on("connect", (req, clientSocket) => {
    void (async () => {
      const [host, portRaw] = String(req.url ?? "").split(":");
      const pin = await resolvePublic(host, lookupImpl);
      const port = Number(portRaw || 443);
      if (!pin || !Number.isInteger(port)) {
        clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const upstream = await connectImpl(pin, port);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    })().catch(() => {
      clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
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
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
