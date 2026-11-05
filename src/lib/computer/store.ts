import type { ComputerStore, ComputerTaskRecord, TaskStatus } from "@/lib/computer/orchestrator";
import { prisma } from "@/lib/prisma";

function row(task: {
  id: string;
  computerId: string;
  clientId: string;
  goal: string;
  status: TaskStatus;
  sensitive: boolean;
  result: string;
}): ComputerTaskRecord {
  return task;
}

export function prismaComputerStore(): ComputerStore {
  return {
    async ensure(clientId) {
      const computer = await prisma.computer.upsert({
        where: { clientId },
        update: {},
        create: { clientId },
      });
      return { id: computer.id };
    },
    async insert(task) {
      return row(await prisma.computerTask.create({ data: task }));
    },
    async finish(id, status, result) {
      return row(await prisma.computerTask.update({ where: { id }, data: { status, result } }));
    },
    async get(id) {
      const task = await prisma.computerTask.findUnique({ where: { id } });
      return task ? row(task) : null;
    },
  };
}
