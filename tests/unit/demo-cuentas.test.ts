import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  desactivarCuentasDemo,
  formatearDesactivacion,
  MENSAJE_SEED_BLOQUEADO,
  permiteCargarSeedDemo,
  type AlmacenDemo,
  type BloqueoPendiente,
  type CuentaDemo,
} from "@/lib/demo-cuentas";
import { hashPassword, verifyPassword } from "@/lib/password";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/verificar-produccion";

const AHORA = new Date("2026-11-03T12:00:00.000Z");
const ANTES = new Date("2026-10-01T12:00:00.000Z");

type Fila = CuentaDemo & { authVersion: number };

function memoria(filas: Fila[]) {
  const aplicadas: BloqueoPendiente[] = [];
  const almacen: AlmacenDemo = {
    async buscar(email) {
      const fila = filas.find((item) => item.email === email);
      if (!fila) return null;
      return {
        id: fila.id,
        email: fila.email,
        passwordHash: fila.passwordHash,
        organizations: fila.organizations.map((empresa) => ({ ...empresa })),
      };
    },
    async aplicar(bloqueo) {
      aplicadas.push(bloqueo);
      const fila = filas.find((item) => item.id === bloqueo.userId);
      if (!fila) throw new Error("La cuenta no está.");
      for (const id of bloqueo.organizationIds) {
        const empresa = fila.organizations.find((item) => item.id === id);
        if (empresa && empresa.suspendedAt === null) empresa.suspendedAt = bloqueo.at;
      }
      if (bloqueo.nuevaClave) fila.passwordHash = bloqueo.nuevaClave;
      fila.authVersion += 1;
    },
  };
  return { almacen, aplicadas, filas };
}

describe("seed en producción", () => {
  test("solo carga las cuentas demo si DEMO_SEED es exactamente true", () => {
    expect(permiteCargarSeedDemo({})).toBe(true);
    expect(permiteCargarSeedDemo({ NODE_ENV: "development" })).toBe(true);
    expect(permiteCargarSeedDemo({ NODE_ENV: "test", DEMO_SEED: "" })).toBe(true);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production" })).toBe(false);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production", DEMO_SEED: "" })).toBe(false);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production", DEMO_SEED: "1" })).toBe(false);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production", DEMO_SEED: "TRUE" })).toBe(false);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production", DEMO_SEED: "true" })).toBe(true);
    expect(permiteCargarSeedDemo({ NODE_ENV: "production", DEMO_SEED: " true " })).toBe(true);
    expect(MENSAJE_SEED_BLOQUEADO).toContain("DEMO_SEED=true");
    expect(MENSAJE_SEED_BLOQUEADO).not.toContain("SEED_DEMO");
  });

  test("el seed usa ese permiso y no el interruptor viejo", () => {
    const seed = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");
    expect(seed).toContain("permiteCargarSeedDemo(process.env)");
    expect(seed).toContain("MENSAJE_SEED_BLOQUEADO");
    expect(seed).toContain("suspendedAt: null");
    expect(seed).not.toContain("SEED_DEMO");
    for (const email of DEMO_ACCOUNTS) expect(seed).toContain(email);
  });
});

describe("desactivar cuentas demo", () => {
  test("suspende, deja inservible la clave del seed y no toca a otra empresa", async () => {
    const claveDemo = await hashPassword(DEMO_PASSWORD);
    const clavePropia = await hashPassword("Otra-clave-2026");
    const { almacen, aplicadas, filas } = memoria([
      {
        id: "user-maria",
        email: DEMO_ACCOUNTS[0],
        passwordHash: claveDemo,
        authVersion: 0,
        organizations: [
          { id: "org-aromos", suspendedAt: null },
          { id: "org-ya", suspendedAt: ANTES },
        ],
      },
      {
        id: "user-pedro",
        email: DEMO_ACCOUNTS[1],
        passwordHash: clavePropia,
        authVersion: 4,
        organizations: [{ id: "org-puerto", suspendedAt: null }],
      },
      {
        id: "user-real",
        email: "dueno@ejemplo.cl",
        passwordHash: clavePropia,
        authVersion: 2,
        organizations: [{ id: "org-real", suspendedAt: null }],
      },
    ]);

    const resultados = await desactivarCuentasDemo(almacen, AHORA);
    expect(resultados.map((item) => item.email)).toEqual([...DEMO_ACCOUNTS]);
    expect(resultados[0]).toMatchObject({ estado: "bloqueada", empresas: 1, claveInvalidada: true });
    expect(resultados[1]).toMatchObject({ estado: "bloqueada", empresas: 1, claveInvalidada: false });
    expect(aplicadas).toHaveLength(2);

    const maria = filas[0];
    const pedro = filas[1];
    const real = filas[2];
    expect(maria?.organizations[0]?.suspendedAt).toEqual(AHORA);
    expect(maria?.organizations[1]?.suspendedAt).toEqual(ANTES);
    expect(maria?.authVersion).toBe(1);
    expect(maria ? await verifyPassword(DEMO_PASSWORD, maria.passwordHash) : true).toBe(false);
    expect(pedro?.organizations[0]?.suspendedAt).toEqual(AHORA);
    expect(pedro?.passwordHash).toBe(clavePropia);
    expect(pedro?.authVersion).toBe(5);
    expect(real?.organizations[0]?.suspendedAt).toBeNull();
    expect(real?.authVersion).toBe(2);
    expect(real?.passwordHash).toBe(clavePropia);

    const informe = formatearDesactivacion(resultados);
    expect(informe).toContain("quedó bloqueada");
    expect(informe).toContain("No se borraron datos.");
    expect(informe).not.toContain(DEMO_PASSWORD);
    expect(informe).not.toContain(claveDemo);
  });

  test("es idempotente: la segunda corrida no escribe", async () => {
    const claveDemo = await hashPassword(DEMO_PASSWORD);
    const { almacen, aplicadas, filas } = memoria([
      {
        id: "user-maria",
        email: DEMO_ACCOUNTS[0],
        passwordHash: claveDemo,
        authVersion: 0,
        organizations: [{ id: "org-aromos", suspendedAt: null }],
      },
    ]);

    const primera = await desactivarCuentasDemo(almacen, AHORA);
    expect(primera[0]?.estado).toBe("bloqueada");
    expect(aplicadas).toHaveLength(1);
    const claveBloqueada = filas[0]?.passwordHash ?? "";
    const segunda = await desactivarCuentasDemo(almacen, new Date("2026-12-01T00:00:00.000Z"));
    expect(segunda[0]).toEqual({ email: DEMO_ACCOUNTS[0], estado: "ya_bloqueada" });
    expect(segunda[1]).toEqual({ email: DEMO_ACCOUNTS[1], estado: "ausente" });
    expect(aplicadas).toHaveLength(1);
    expect(filas[0]?.passwordHash).toBe(claveBloqueada);
    expect(filas[0]?.authVersion).toBe(1);
    expect(filas[0]?.organizations[0]?.suspendedAt).toEqual(AHORA);
    expect(formatearDesactivacion(segunda)).toContain("ya estaba bloqueada");
    expect(formatearDesactivacion(segunda)).toContain("no está en la base");
  });

  test("si ya estaba suspendida y la clave sigue siendo la del seed, solo cambia la clave", async () => {
    const claveDemo = await hashPassword(DEMO_PASSWORD);
    const { almacen, aplicadas, filas } = memoria([
      {
        id: "user-maria",
        email: DEMO_ACCOUNTS[0],
        passwordHash: claveDemo,
        authVersion: 3,
        organizations: [{ id: "org-aromos", suspendedAt: ANTES }],
      },
    ]);
    const resultados = await desactivarCuentasDemo(almacen, AHORA);
    expect(resultados[0]).toMatchObject({ estado: "bloqueada", empresas: 0, claveInvalidada: true });
    expect(aplicadas[0]?.organizationIds).toEqual([]);
    expect(aplicadas[0]?.nuevaClave).toBeTruthy();
    expect(filas[0]?.organizations[0]?.suspendedAt).toEqual(ANTES);
    expect(filas[0]?.authVersion).toBe(4);
    expect(filas[0] ? await verifyPassword(DEMO_PASSWORD, filas[0].passwordHash) : true).toBe(false);
  });

  test("el script usa DATABASE_URL y no borra filas", () => {
    const script = readFileSync(new URL("../../scripts/desactivar-demo.ts", import.meta.url), "utf8");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["desactivar:demo"]).toBe("tsx scripts/desactivar-demo.ts");
    expect(script).toContain("DATABASE_URL");
    expect(script).not.toMatch(/\.delete\b/);
    expect(script).toContain("suspendedAt");
    expect(script).toContain("authVersion");
  });
});
