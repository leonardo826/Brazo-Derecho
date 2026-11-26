import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { attachTransactionScope, connectTimeoutMillis, DB_RETRY_BUDGET_MS, runDbOperation } from "./db-retry";
import { databaseUrl } from "./env";

export { Prisma } from "../generated/prisma/client";
export type { AgentKind, AuthTokenKind, MemberRole } from "../generated/prisma/client";

export function createPrismaClient() {
  const connectionString = databaseUrl();
  const connectTimeoutMs = connectTimeoutMillis(connectionString);
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: connectTimeoutMs });
  const client = new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          return runDbOperation(operation, () => query(args), {
            connectTimeoutMs,
            budgetMs: DB_RETRY_BUDGET_MS,
          });
        },
      },
    },
  });
  // Sigue tipado como PrismaClient. Las lecturas reintentan un corte; dentro de
  // $transaction no, para no repetir una escritura que ya entró.
  attachTransactionScope(client as unknown as { $transaction: (...args: never[]) => Promise<unknown> });
  return client as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production" && process.env.VITEST !== "true") {
  globalForPrisma.prisma = prisma;
}
