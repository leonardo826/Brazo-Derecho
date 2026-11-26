import { prisma } from "@/lib/prisma";

export type MachineRef = {
  organizationId: string;
  machineId: string;
};

export type MachineEndpoint = {
  origin: string;
  pin: string;
};

export type ProviderMachineStatus = "off" | "starting" | "running" | "stopping" | "error";

export type StaticMachine = {
  machineId: string;
  origin: string;
  pin: string;
};

/**
 * Un computador por empresa. Hoy no hay SDK de nube: el VPS manual entra por StaticProvider.
 * start y stop de ese proveedor no apagan la máquina.
 */
export type ComputerProvider = {
  kind: string;
  create(ref: MachineRef): Promise<{ machineId: string }>;
  start(ref: MachineRef): Promise<void>;
  stop(ref: MachineRef): Promise<void>;
  delete(ref: MachineRef): Promise<void>;
  status(ref: MachineRef): Promise<ProviderMachineStatus>;
  getEndpoint(ref: MachineRef): Promise<MachineEndpoint | null>;
};

export function staticProvider(load: (organizationId: string) => Promise<StaticMachine | null>): ComputerProvider {
  return {
    kind: "static",
    async create(ref) {
      const current = await load(ref.organizationId);
      return { machineId: current?.machineId || ref.machineId };
    },
    async start() {
      return undefined;
    },
    async stop() {
      return undefined;
    },
    async delete() {
      return undefined;
    },
    async status() {
      return "running";
    },
    async getEndpoint(ref) {
      const current = await load(ref.organizationId);
      if (!current?.origin || !current.pin) return null;
      return { origin: current.origin, pin: current.pin };
    },
  };
}

async function loadEnrolledMachine(organizationId: string): Promise<StaticMachine | null> {
  const row = await prisma.computer.findUnique({
    where: { clientId: organizationId },
    select: { machineId: true, agentEndpoint: true, agentPinnedAddress: true, status: true },
  });
  if (!row || row.status !== "RUNNING" || !row.agentEndpoint || !row.agentPinnedAddress) return null;
  return { machineId: row.machineId, origin: row.agentEndpoint, pin: row.agentPinnedAddress };
}

/** El piloto Vultr. No compra ni apaga el VPS. */
export function defaultComputerProvider(): ComputerProvider {
  return staticProvider(loadEnrolledMachine);
}

export type FakeProvider = ComputerProvider & {
  calls: { create: number; start: number; stop: number; delete: number };
  endpoint: MachineEndpoint | null;
  machineStatus: ProviderMachineStatus;
};

export function fakeProvider(seed: { endpoint?: MachineEndpoint | null; status?: ProviderMachineStatus } = {}): FakeProvider {
  const provider: FakeProvider = {
    kind: "fake",
    calls: { create: 0, start: 0, stop: 0, delete: 0 },
    endpoint: seed.endpoint === undefined ? { origin: "https://vm.ejemplo.cl", pin: "93.184.216.34" } : seed.endpoint,
    machineStatus: seed.status ?? "off",
    async create(ref) {
      provider.calls.create += 1;
      return { machineId: ref.machineId };
    },
    async start() {
      provider.calls.start += 1;
      provider.machineStatus = "running";
    },
    async stop() {
      provider.calls.stop += 1;
      provider.machineStatus = "off";
    },
    async delete() {
      provider.calls.delete += 1;
      provider.machineStatus = "off";
      provider.endpoint = null;
    },
    async status() {
      return provider.machineStatus;
    },
    async getEndpoint() {
      return provider.endpoint;
    },
  };
  return provider;
}
