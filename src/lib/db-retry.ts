import { AsyncLocalStorage } from "node:async_hooks";
import { logEvent } from "@/lib/log";

/** Tres intentos como máximo. Las esperas suman menos de un segundo. */
export const DB_RETRY_ATTEMPTS = 3;
export const DB_RETRY_DELAYS_MS = [200, 600] as const;
/**
 * Tope de la espera que ve el llamador. Cabe un connect_timeout de 7 s
 * y un reintento rápido, y queda bajo los 10 s de una función en Vercel.
 */
export const DB_RETRY_BUDGET_MS = 8_500;
export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 7;

const TRANSIENT_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const TRANSIENT_NODE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN", "ENOTFOUND"]);
const TRANSIENT_KINDS = new Set(["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout"]);
/** 57P03: el cómputo de Neon todavía está arrancando. 08xxx: la conexión se cayó. */
const TRANSIENT_SQLSTATE = new Set(["08000", "08001", "08003", "08004", "08006", "57P01", "57P02", "57P03"]);
const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const TRANSIENT_MESSAGE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|timeout expired|timeout exceeded when trying to connect|connection terminated|timed out|can't reach database server|server has closed the connection|the database system is starting up/i;

const transactionScope = new AsyncLocalStorage<true>();

export type RetryOptions = {
  attempts?: number;
  delaysMs?: readonly number[];
  budgetMs?: number;
  connectTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type ErrorRecord = Record<string, unknown>;

/** True si la operación es una lectura. Las escrituras no se reintentan. */
export function retriesOperation(operation: string) {
  return READ_OPERATIONS.has(operation);
}

export function inDbTransaction() {
  return transactionScope.getStore() === true;
}

export function runInDbTransaction<T>(run: () => Promise<T>) {
  return transactionScope.run(true, run);
}

export function attachTransactionScope<T extends { $transaction: (...args: never[]) => Promise<unknown> }>(client: T) {
  const original = client.$transaction.bind(client);
  client.$transaction = ((...args: never[]) => runInDbTransaction(() => original(...args))) as T["$transaction"];
  return client;
}

export function runDbOperation<T>(operation: string, run: () => Promise<T>, options?: RetryOptions) {
  if (!retriesOperation(operation) || inDbTransaction()) return run();
  return withTransientRetry(run, options);
}

export async function withTransientRetry<T>(run: () => Promise<T>, options: RetryOptions = {}) {
  const attempts = options.attempts ?? DB_RETRY_ATTEMPTS;
  const delaysMs = options.delaysMs ?? DB_RETRY_DELAYS_MS;
  const budgetMs = options.budgetMs ?? DB_RETRY_BUDGET_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_SECONDS * 1_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const started = now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const delayMs = delaysMs[attempt - 1] ?? 0;
      const elapsed = now() - started;
      const canRetry =
        attempt < attempts &&
        isTransientConnectionError(error) &&
        elapsed + delayMs + connectTimeoutMs <= budgetMs;
      if (!canRetry) throw error;
      logEvent("db.reintento", { codigo: transientErrorCode(error), intento: attempt });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Agrega connect_timeout a la URL si no viene. No reescribe usuario ni clave:
 * `pg` no aplica el parámetro de la URL, así que el cliente lo copia a
 * connectionTimeoutMillis aparte, sin registrar la cadena.
 */
export function withConnectTimeout(connectionString: string, seconds = DEFAULT_CONNECT_TIMEOUT_SECONDS) {
  if (hasConnectTimeout(connectionString)) return connectionString;
  const safeSeconds = normalizeTimeoutSeconds(seconds);
  const hashAt = connectionString.indexOf("#");
  const base = hashAt === -1 ? connectionString : connectionString.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : connectionString.slice(hashAt);
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}connect_timeout=${safeSeconds}${hash}`;
}

export function connectTimeoutMillis(connectionString: string, fallbackSeconds = DEFAULT_CONNECT_TIMEOUT_SECONDS) {
  const match = /(?:^|[?&])connect_timeout=(\d+)/i.exec(connectionString);
  if (!match) return normalizeTimeoutSeconds(fallbackSeconds) * 1_000;
  return Number(match[1]) * 1_000;
}

export function isTransientConnectionError(error: unknown) {
  const prismaCode = firstPrismaCode(error);
  if (prismaCode) return TRANSIENT_PRISMA_CODES.has(prismaCode);
  if (firstNetworkSignal(error)) return true;
  return TRANSIENT_MESSAGE.test(collectMessages(error));
}

function transientErrorCode(error: unknown) {
  const prismaCode = firstPrismaCode(error);
  if (prismaCode && TRANSIENT_PRISMA_CODES.has(prismaCode)) return prismaCode;
  const signal = firstNetworkSignal(error);
  if (signal) return signal;
  return "timeout";
}

function firstPrismaCode(error: unknown) {
  return firstString(error, (record) => {
    const code = stringField(record, "code");
    return code && /^P\d{4}$/.test(code) ? code : undefined;
  });
}

function firstNetworkSignal(error: unknown) {
  return firstString(error, (record) => {
    const code = stringField(record, "code") ?? stringField(record, "originalCode");
    if (code && (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_SQLSTATE.has(code))) return code;
    const kind = stringField(record, "kind");
    if (kind && TRANSIENT_KINDS.has(kind)) return kind;
    if (kind === "postgres") {
      const sqlState = stringField(record, "code");
      if (sqlState && TRANSIENT_SQLSTATE.has(sqlState)) return sqlState;
    }
    return undefined;
  });
}

function firstString(error: unknown, read: (record: ErrorRecord) => string | undefined) {
  let found: string | undefined;
  visitError(error, (record) => {
    if (!found) found = read(record);
  });
  return found;
}

function collectMessages(error: unknown) {
  const parts: string[] = [];
  visitError(error, (record) => {
    for (const key of ["message", "originalMessage"]) {
      const value = stringField(record, key);
      if (value) parts.push(value.slice(0, 300));
    }
  });
  return parts.join(" ");
}

function visitError(error: unknown, visit: (record: ErrorRecord) => void) {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 5) return;
    seen.add(value);
    const record = value as ErrorRecord;
    visit(record);
    walk(record.cause, depth + 1);
    walk(record.meta, depth + 1);
    walk(record.driverAdapterError, depth + 1);
  };
  walk(error, 0);
}

function stringField(record: ErrorRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hasConnectTimeout(connectionString: string) {
  return /(?:^|[?&])connect_timeout=/i.test(connectionString);
}

function normalizeTimeoutSeconds(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) {
    throw new Error("connect_timeout fuera de rango");
  }
  return seconds;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
