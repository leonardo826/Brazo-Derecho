import { LOCAL_HARNESS, enrollComputerLease, revokeComputerLease } from "../src/lib/computer/lease";
import { pinnedRequest } from "../src/lib/computer/pinned-fetch";
import { decryptSecret, readMasterKey } from "../src/lib/credentials/crypto";
import { prisma } from "../src/lib/prisma";

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

function emit(fields: Record<string, string | number | boolean>) {
  process.stdout.write(`${JSON.stringify(fields)}\n`);
}

function fail(outcome: string): number {
  emit({
    action: process.argv[2] ?? "",
    operatorId: flag("--operator"),
    organizationId: flag("--client"),
    machineId: flag("--machine"),
    outcome,
  });
  return 1;
}

async function tokenFromOperator() {
  const fromEnv = process.env.COMPUTER_LEASE_TOKEN?.trim() ?? "";
  if (fromEnv) return fromEnv;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function refuseTokenOnArgv(token: string) {
  if (!token) return false;
  if (process.argv.some((arg) => arg.includes(token))) {
    process.stderr.write("rechazo: el token no va en argumentos\n");
    return true;
  }
  return false;
}

async function harnessRow(organizationId: string) {
  const row = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!row || row.status !== "RUNNING" || !row.agentEndpoint.startsWith("http://127.0.0.1")) return null;
  const again = await prisma.computer.findUnique({ where: { clientId: organizationId } });
  if (!again || again.leaseEpoch !== row.leaseEpoch || again.status !== "RUNNING") return null;
  let token = "";
  try {
    token = decryptSecret(
      { ciphertext: again.agentTokenCiphertext, iv: again.agentTokenIv, authTag: again.agentTokenAuthTag },
      readMasterKey(),
      `v1\n${organizationId}\n${again.machineId}`,
    );
  } catch {
    return null;
  }
  return { row: again, token };
}

async function main() {
  const command = process.argv[2] ?? "";
  const operatorId = flag("--operator");
  const organizationId = flag("--client");
  const machineId = flag("--machine");
  if (command === "harness-enroll") {
    const token = await tokenFromOperator();
    if (refuseTokenOnArgv(token)) return 2;
    if (!process.argv.includes("--attest-ownership")) return fail("sin-attest");
    const endpoint = flag("--endpoint");
    if (!endpoint.startsWith("http://127.0.0.1:")) return fail("no-harness");
    const saved = await enrollComputerLease(
      { organizationId, machineId, endpoint, token, operatorId },
      process.env,
      { harness: LOCAL_HARNESS },
    );
    emit({
      action: "enroll",
      operatorId,
      organizationId,
      machineId: saved.ok ? saved.machineId : machineId,
      outcome: saved.ok ? "ok" : saved.error,
      leaseEpoch: saved.ok ? saved.leaseEpoch : 0,
    });
    return saved.ok ? 0 : 1;
  }
  if (command === "harness-status" || command === "harness-dispatch" || command === "harness-cancel") {
    const current = await harnessRow(organizationId);
    if (!current) return fail("rechazado");
    const path = command === "harness-status" ? "/status" : command === "harness-cancel" ? "/task/cancel" : "/task";
    const method = command === "harness-status" ? "GET" : "POST";
    const body =
      command === "harness-dispatch"
        ? JSON.stringify({ goal: flag("--goal") || "estado", machineId: current.row.machineId })
        : command === "harness-cancel"
          ? JSON.stringify({ machineId: current.row.machineId })
          : undefined;
    const response = await pinnedRequest({
      origin: current.row.agentEndpoint,
      pin: "127.0.0.1",
      path,
      method,
      headers: {
        authorization: `Bearer ${current.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
    });
    const outcome = command === "harness-dispatch" ? "no-real" : response.status === 200 ? "ok" : "fallo";
    emit({ action: command.replace("harness-", ""), operatorId, organizationId, machineId: current.row.machineId, outcome, leaseEpoch: current.row.leaseEpoch });
    return response.status === 200 ? 0 : 1;
  }
  if (command === "revoke") {
    const saved = await revokeComputerLease(organizationId, operatorId);
    emit({
      action: "revoke",
      operatorId,
      organizationId,
      machineId,
      outcome: saved.ok ? "ok" : saved.error,
      leaseEpoch: saved.ok ? saved.leaseEpoch : 0,
    });
    return saved.ok ? 0 : 1;
  }
  process.stderr.write("uso: harness-enroll | harness-status | harness-dispatch | harness-cancel | revoke\n");
  return 2;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async () => {
    process.stderr.write("rechazo: fallo del comando\n");
    await prisma.$disconnect();
    process.exit(1);
  });
