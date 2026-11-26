import http from "node:http";
import { describe, expect, test } from "vitest";
import { callMachine } from "@/lib/computer/transport";

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("transporte fijado", () => {
  test("un redirect no se sigue, tampoco hacia loopback", async () => {
    let followed = 0;
    const secret = http.createServer((_req, res) => {
      followed += 1;
      res.writeHead(200);
      res.end("secreto");
    });
    const secretPort = await listen(secret);
    const front = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${secretPort}/secreto` });
      res.end();
    });
    const port = await listen(front);
    const result = await callMachine({
      origin: `http://127.0.0.1:${port}`,
      pin: "127.0.0.1",
      path: "/handshake",
      method: "GET",
      headers: {},
      allowLoopback: true,
    });
    expect(result.status).toBe(302);
    expect(result.body).toBe("");
    expect(followed).toBe(0);
    await new Promise<void>((resolve) => front.close(() => resolve()));
    await new Promise<void>((resolve) => secret.close(() => resolve()));
  });

  test("si el DNS ya no contiene la IP fijada no hay conexión", async () => {
    await expect(
      callMachine({
        origin: "https://equipo.example",
        pin: "93.184.216.34",
        path: "/task",
        method: "POST",
        headers: { authorization: "Bearer secreto" },
        lookupImpl: async () => [{ address: "10.0.0.8", family: 4 }],
      }),
    ).rejects.toThrow(/transporte/);
  });
});
