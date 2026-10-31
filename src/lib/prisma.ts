import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export { Prisma } from "../generated/prisma/client";
export type { AgentKind, AuthTokenKind, MemberRole } from "../generated/prisma/client";

export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim() ?? "";
  if (!connectionString) throw new Error("Falta DATABASE_URL");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production" && process.env.VITEST !== "true") {
  globalForPrisma.prisma = prisma;
}
