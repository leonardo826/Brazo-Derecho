import { databaseConnectTimeoutMs } from "@/lib/env";
import { DB_RETRY_BUDGET_MS, withTransientRetry } from "@/lib/db-retry";
import { prisma } from "@/lib/prisma";

function pingDatabase() {
  return prisma.$queryRaw`SELECT 1`;
}

/**
 * SELECT 1 con reintento. El tope anterior de 2 s devolvía 503 mientras Neon
 * despertaba; esta espera cabe en el presupuesto y solo se repite si el corte
 * es de conexión.
 */
export async function databaseAnswers(query: () => Promise<unknown> = pingDatabase, budgetMs = DB_RETRY_BUDGET_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = withTransientRetry(query, {
    budgetMs,
    connectTimeoutMs: databaseConnectTimeoutMs(),
  }).then(
    () => true,
    () => false,
  );
  const limit = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  try {
    return await Promise.race([attempt, limit]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
