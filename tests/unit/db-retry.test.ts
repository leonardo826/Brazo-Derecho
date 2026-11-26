import { afterEach, describe, expect, test, vi } from "vitest";
import { databaseUrl } from "@/lib/env";
import { databaseAnswers } from "@/lib/health";
import {
  DB_RETRY_ATTEMPTS,
  DB_RETRY_BUDGET_MS,
  DB_RETRY_DELAYS_MS,
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  attachTransactionScope,
  connectTimeoutMillis,
  inDbTransaction,
  isTransientConnectionError,
  retriesOperation,
  runDbOperation,
  runInDbTransaction,
  withConnectTimeout,
  withTransientRetry,
} from "@/lib/db-retry";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function connectionError(code: string, message = `fallo ${code}`) {
  return Object.assign(new Error(message), { code });
}

describe("reintento de conexión", () => {
  test("el presupuesto cabe en menos de 10 s y alcanza para un connect y un reintento", () => {
    expect(DB_RETRY_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(DB_RETRY_ATTEMPTS).toBeLessThanOrEqual(3);
    expect(DB_RETRY_BUDGET_MS).toBeLessThan(10_000);
    expect(DB_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0)).toBeLessThan(1_000);
    expect(1_000 + DEFAULT_CONNECT_TIMEOUT_SECONDS * 1_000).toBeLessThanOrEqual(DB_RETRY_BUDGET_MS);
  });

  test("un corte transitorio se reintenta y el acierto devuelve el valor", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw connectionError("P1001", "Can't reach database server at `ep-secret.neon.tech:5432`");
        }
        return "listo";
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        connectTimeoutMs: 7_000,
        budgetMs: 8_500,
      },
    );
    expect(result).toBe("listo");
    expect(calls).toBe(3);
    expect(sleeps).toEqual([200, 600]);
  });

  test("reconoce los cortes de conexión y no un error lógico", () => {
    expect(isTransientConnectionError(connectionError("P1001"))).toBe(true);
    expect(isTransientConnectionError(connectionError("P1002"))).toBe(true);
    expect(isTransientConnectionError(connectionError("P1008"))).toBe(true);
    expect(isTransientConnectionError(connectionError("P1017"))).toBe(true);
    expect(isTransientConnectionError(connectionError("P2024"))).toBe(true);
    expect(isTransientConnectionError(connectionError("ECONNRESET"))).toBe(true);
    expect(isTransientConnectionError(connectionError("57P03", "the database system is starting up"))).toBe(true);
    expect(isTransientConnectionError(new Error("timeout expired"))).toBe(true);
    expect(isTransientConnectionError(new Error("Connection terminated unexpectedly"))).toBe(true);
    const adapter = new Error("adapter");
    adapter.cause = { kind: "SocketTimeout" };
    expect(isTransientConnectionError(adapter)).toBe(true);
    const closed = new Error("cerrada");
    closed.cause = { kind: "ConnectionClosed", originalCode: "ECONNRESET" };
    expect(isTransientConnectionError(closed)).toBe(true);
    expect(isTransientConnectionError(connectionError("P2002", "Unique constraint failed on timeout"))).toBe(false);
    expect(isTransientConnectionError(connectionError("P2025", "Record to update not found"))).toBe(false);
    expect(isTransientConnectionError(new Error("el correo ya existe"))).toBe(false);
  });

  test("un error lógico no se reintenta", async () => {
    let calls = 0;
    await expect(
      withTransientRetry(async () => {
        calls += 1;
        throw connectionError("P2002", "Unique constraint failed on timeout");
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(calls).toBe(1);
  });

  test("no reintenta si otro connect ya no cabe en el presupuesto", async () => {
    let clock = 0;
    let calls = 0;
    await expect(
      withTransientRetry(
        async () => {
          calls += 1;
          clock = 7_000;
          throw connectionError("ECONNRESET");
        },
        {
          now: () => clock,
          sleep: async () => {
            throw new Error("no debía esperar");
          },
          connectTimeoutMs: 7_000,
          budgetMs: 8_500,
        },
      ),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(calls).toBe(1);
  });

  test("las escrituras no se reintentan", async () => {
    for (const operation of ["create", "update", "upsert", "delete", "deleteMany", "executeRaw", "$executeRaw"]) {
      let calls = 0;
      await expect(
        runDbOperation(operation, async () => {
          calls += 1;
          throw connectionError("ECONNRESET");
        }),
      ).rejects.toMatchObject({ code: "ECONNRESET" });
      expect(calls).toBe(1);
      expect(retriesOperation(operation)).toBe(false);
    }
  });

  test("una lectura sí se reintenta y dentro de una transacción no", async () => {
    let clock = 0;
    let reads = 0;
    const read = () =>
      runDbOperation(
        "findUnique",
        async () => {
          reads += 1;
          if (reads === 1) throw connectionError("P2024");
          return { id: "1" };
        },
        {
          now: () => clock,
          sleep: async (ms) => {
            clock += ms;
          },
          connectTimeoutMs: 7_000,
          budgetMs: 8_500,
        },
      );
    await expect(read()).resolves.toEqual({ id: "1" });
    expect(reads).toBe(2);

    let trapped = 0;
    await runInDbTransaction(async () => {
      expect(inDbTransaction()).toBe(true);
      await expect(
        runDbOperation("findUnique", async () => {
          trapped += 1;
          throw connectionError("ECONNRESET");
        }),
      ).rejects.toMatchObject({ code: "ECONNRESET" });
    });
    expect(trapped).toBe(1);
    expect(inDbTransaction()).toBe(false);
  });

  test("el log del reintento no incluye la URL ni el host", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(String(line));
    });
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw connectionError("P1001", "Can't reach database server at `ep-secret.neon.tech:5432`");
        }
        return true;
      },
      {
        now: () => 0,
        sleep: async () => {},
        connectTimeoutMs: 7_000,
        budgetMs: 8_500,
      },
    );
    const logged = lines.join("\n");
    expect(logged).toContain("db.reintento");
    expect(logged).toContain("P1001");
    expect(logged).not.toContain("ep-secret");
    expect(logged).not.toContain("postgresql");
    expect(logged).not.toContain("neon.tech");
  });
});

describe("connect_timeout", () => {
  test("lo agrega una sola vez y no reescribe la clave", () => {
    const secret = "postgresql://usuario:s3cr%40t@ep-abc.neon.tech/brazo?sslmode=require";
    const withTimeout = withConnectTimeout(secret);
    expect(withTimeout).toBe(`${secret}&connect_timeout=${DEFAULT_CONNECT_TIMEOUT_SECONDS}`);
    expect(withConnectTimeout(withTimeout)).toBe(withTimeout);
    expect(withConnectTimeout("postgresql://usuario:s3cr%40t@host/db")).toBe(
      `postgresql://usuario:s3cr%40t@host/db?connect_timeout=${DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
    );
    const explicit = "postgresql://usuario:s3cr%40t@host/db?Connect_Timeout=12";
    expect(withConnectTimeout(explicit)).toBe(explicit);
    expect(connectTimeoutMillis(explicit)).toBe(12_000);
    expect(connectTimeoutMillis(withTimeout)).toBe(DEFAULT_CONNECT_TIMEOUT_SECONDS * 1_000);
  });

  test("un valor inválido no menciona la URL", () => {
    expect(() => withConnectTimeout("postgresql://usuario:s3cret@host/db", 0)).toThrow(/^connect_timeout fuera de rango$/);
  });

  test("databaseUrl exige la variable y agrega el timeout", () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(() => databaseUrl()).toThrow(/^Falta DATABASE_URL$/);
    vi.stubEnv("DATABASE_URL", " postgresql://usuario:s3cret@ep-abc.neon.tech/brazo?sslmode=require ");
    expect(databaseUrl()).toBe(
      `postgresql://usuario:s3cret@ep-abc.neon.tech/brazo?sslmode=require&connect_timeout=${DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
    );
  });
});

describe("salud", () => {
  test("reintenta un corte transitorio antes de declarar que la base responde", async () => {
    let calls = 0;
    const ok = await databaseAnswers(async () => {
      calls += 1;
      if (calls === 1) throw connectionError("ECONNRESET");
      return 1;
    });
    expect(ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("un error lógico deja la base en error sin reintentar", async () => {
    let calls = 0;
    const ok = await databaseAnswers(async () => {
      calls += 1;
      throw connectionError("P2002");
    });
    expect(ok).toBe(false);
    expect(calls).toBe(1);
  });

  test("corta al vencer el presupuesto", async () => {
    const started = Date.now();
    const ok = await databaseAnswers(() => new Promise(() => {}), 40);
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("transacción", () => {
  test("marca el alcance y lo suelta al terminar", async () => {
    const client = {
      async $transaction(work: () => Promise<string>) {
        return work();
      },
    };
    attachTransactionScope(client);
    const value = await client.$transaction(async () => {
      expect(inDbTransaction()).toBe(true);
      return "ok";
    });
    expect(value).toBe("ok");
    expect(inDbTransaction()).toBe(false);
  });
});
