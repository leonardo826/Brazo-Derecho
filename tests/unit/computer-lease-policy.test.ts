import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { roleMayManageMachine } from "@/lib/admin";
import { acceptHandshake, handshakeProof } from "@/lib/computer/handshake";
import { isPrivateAddress } from "@/lib/computer/private-address";
import { endpointAllowed, leaseGate, LOCAL_HARNESS } from "@/lib/computer/lease";
import { revalidatePin } from "@/lib/computer/transport";
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
    expect(await endpointAllowed("https://[fe9a::1]/")).toBeNull();
    expect(await endpointAllowed("https://[fec0::1]/")).toBeNull();
    expect(await endpointAllowed("https://169.254.169.254")).toBeNull();
    expect(await endpointAllowed("https://100.64.0.1")).toBeNull();
    expect(await endpointAllowed("https://[::ffff:10.1.2.3]/")).toBeNull();
    expect(await endpointAllowed("https://metadata.google.internal")).toBeNull();
    expect(isPrivateAddress("127.000.000.001")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("un nombre público que resuelve a una IP privada no se acepta", async () => {
    const origin = await endpointAllowed("https://equipo.example", {
      lookupImpl: async () => [{ address: "10.0.0.8", family: 4 }],
    });
    expect(origin).toBeNull();
    const mixed = await endpointAllowed("https://equipo.example", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.9", family: 4 },
      ],
    });
    expect(mixed).toBeNull();
    expect(await revalidatePin("equipo.example", "93.184.216.34", async () => [{ address: "1.1.1.1", family: 4 }])).toBe(false);
    expect(await revalidatePin("equipo.example", "10.0.0.8", async () => [{ address: "10.0.0.8", family: 4 }])).toBe(false);
    expect(await revalidatePin("equipo.example", "93.184.216.34", async () => [{ address: "93.184.216.34", family: 4 }])).toBe(true);
  });

  test("el AAD ata el cifrado a la empresa y a la máquina", () => {
    const sealed = encryptSecret("lease-token-123456", key, "v1\norg-a\nmachine-a");
    expect(decryptSecret(sealed, key, "v1\norg-a\nmachine-a")).toBe("lease-token-123456");
    expect(() => decryptSecret(sealed, key, "v1\norg-b\nmachine-a")).toThrow(/cifrado_invalido/);
    expect(() => decryptSecret(sealed, readMasterKey({ CREDENTIALS_MASTER_KEY: Buffer.alloc(32, 9).toString("base64") }), "v1\norg-a\nmachine-a")).toThrow(
      /cifrado_invalido/,
    );
    expect(JSON.stringify(sealed)).not.toContain("lease-token-123456");
    expect(Buffer.from(sealed.ciphertext, "base64").toString("utf8")).not.toContain("lease-token-123456");
  });

  test("el alta no cree un RUNNING que la máquina se atribuye", () => {
    const token = "lease-token-123456";
    const nonce = "nonce-de-prueba-0001";
    const machineId = "machine-1";
    expect(acceptHandshake({ token, nonce, machineId, body: { ok: true, status: "RUNNING", machineId } })).toBe(false);
    expect(acceptHandshake({ token, nonce, machineId, body: { machineId, nonce, proof: token } })).toBe(false);
    expect(
      acceptHandshake({ token, nonce, machineId, body: { machineId, nonce, proof: handshakeProof(token, nonce, machineId) } }),
    ).toBe(true);
    expect(
      acceptHandshake({
        token,
        nonce,
        machineId,
        body: { machineId: "otra", nonce, proof: handshakeProof(token, nonce, "otra") },
      }),
    ).toBe(false);
    expect(leaseGate("STOPPED")).toBe("closed");
    expect(leaseGate("ERROR")).toBe("closed");
    expect(leaseGate("RUNNING")).toBe("running");
    expect(leaseGate("PENDING")).toBe("absent");
    expect(roleMayManageMachine("STAFF", "equipo@cliente.cl", { ADMIN_EMAILS: "admin@brazo.cl" })).toBe(false);
    expect(roleMayManageMachine("OWNER", "dueno@cliente.cl", { ADMIN_EMAILS: "" })).toBe(true);
    expect(roleMayManageMachine("STAFF", "admin@brazo.cl", { ADMIN_EMAILS: "admin@brazo.cl" })).toBe(true);
    const samples = ["127.0.0.1", "8.8.8.8", "fe9a::1", "2606:4700:4700::1111", "::ffff:10.0.0.1"];
    const compared = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { handshakeProof, isPrivateAddress } from "./machine-agent/src/protocol.mjs";
         const samples = ${JSON.stringify(samples)};
         process.stdout.write(JSON.stringify({ proof: handshakeProof(${JSON.stringify(token)}, ${JSON.stringify(nonce)}, ${JSON.stringify(machineId)}), flags: samples.map((item) => isPrivateAddress(item)) }));`,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(compared.status).toBe(0);
    const parsed = JSON.parse(compared.stdout) as { proof: string; flags: boolean[] };
    expect(parsed.proof).toBe(handshakeProof(token, nonce, machineId));
    expect(parsed.flags).toEqual(samples.map((item) => isPrivateAddress(item)));
  });

  test("la ruta pública no proclama la máquina ni sale a la red", () => {
    const source = readFileSync("src/app/api/computer/lease/route.ts", "utf8");
    expect(source).not.toMatch(/enrollComputerLease|pinnedRequest|fetch\(/);
  });
});
