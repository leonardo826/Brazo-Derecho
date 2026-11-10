import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { endpointAllowed, LOCAL_HARNESS } from "@/lib/computer/lease";
import { decryptSecret, encryptSecret, readMasterKey } from "@/lib/credentials/crypto";

const key = Buffer.alloc(32, 7);

describe("frontera del origen del computador", () => {
  test("rechaza loopback, red privada, IPv6 local e internos sin mirar NODE_ENV", async () => {
    expect(await endpointAllowed("http://127.0.0.1:8787")).toBeNull();
    expect(await endpointAllowed("http://localhost:8787", { harness: LOCAL_HARNESS })).toBeNull();
    expect(await endpointAllowed("http://127.0.0.1:8787", { harness: LOCAL_HARNESS })).toEqual({
      origin: "http://127.0.0.1:8787",
      pin: "127.0.0.1",
    });
    expect(await endpointAllowed("https://10.1.2.3")).toBeNull();
    expect(await endpointAllowed("https://192.168.0.8")).toBeNull();
    expect(await endpointAllowed("https://[::1]/")).toBeNull();
    expect(await endpointAllowed("https://[fc00::1]/")).toBeNull();
    expect(await endpointAllowed("https://[fe80::1]/")).toBeNull();
    expect(await endpointAllowed("http://app.internal:8787")).toBeNull();
    expect(await endpointAllowed("https://equipo.local")).toBeNull();
  });

  test("un nombre público que resuelve a una IP privada no se acepta", async () => {
    const origin = await endpointAllowed("https://equipo.example", {
      lookupImpl: async () => [{ address: "10.0.0.8", family: 4 }],
    });
    expect(origin).toBeNull();
  });

  test("el AAD ata el cifrado a la empresa y a la máquina", () => {
    const sealed = encryptSecret("lease-token-123456", key, "v1\norg-a\nmachine-a");
    expect(decryptSecret(sealed, key, "v1\norg-a\nmachine-a")).toBe("lease-token-123456");
    expect(() => decryptSecret(sealed, key, "v1\norg-b\nmachine-a")).toThrow(/cifrado_invalido/);
    expect(() => decryptSecret(sealed, readMasterKey({ CREDENTIALS_MASTER_KEY: Buffer.alloc(32, 9).toString("base64") }), "v1\norg-a\nmachine-a")).toThrow(
      /cifrado_invalido/,
    );
  });

  test("no hay un POST para que la empresa se proclame dueña", () => {
    expect(existsSync("src/app/api/computer/lease/route.ts")).toBe(false);
  });
});
