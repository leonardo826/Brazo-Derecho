import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/password";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/verificar-produccion";

export const MENSAJE_SEED_BLOQUEADO =
  "El seed de demostración no corre en producción. Define DEMO_SEED=true si de verdad quieres cargarlo.";

/**
 * En producción las cuentas demo solo se cargan con DEMO_SEED exactamente `true`.
 * Fuera de producción el seed sigue corriendo, como en local.
 */
export function permiteCargarSeedDemo(env: { NODE_ENV?: string; DEMO_SEED?: string }) {
  if (env.NODE_ENV !== "production") return true;
  return env.DEMO_SEED?.trim() === "true";
}

export type EmpresaDemo = {
  id: string;
  suspendedAt: Date | null;
};

export type CuentaDemo = {
  id: string;
  email: string;
  passwordHash: string;
  organizations: EmpresaDemo[];
};

export type BloqueoPendiente = {
  userId: string;
  nuevaClave: string | null;
  organizationIds: string[];
  at: Date;
};

export type AlmacenDemo = {
  buscar(email: string): Promise<CuentaDemo | null>;
  aplicar(bloqueo: BloqueoPendiente): Promise<void>;
};

export type ResultadoDemo =
  | { email: string; estado: "ausente" }
  | { email: string; estado: "ya_bloqueada" }
  | { email: string; estado: "bloqueada"; empresas: number; claveInvalidada: boolean };

export async function desactivarCuentasDemo(almacen: AlmacenDemo, ahora = new Date()) {
  const resultados: ResultadoDemo[] = [];
  for (const email of DEMO_ACCOUNTS) {
    const cuenta = await almacen.buscar(email);
    if (!cuenta) {
      resultados.push({ email, estado: "ausente" });
      continue;
    }
    const organizationIds = cuenta.organizations.filter((empresa) => empresa.suspendedAt === null).map((empresa) => empresa.id);
    const claveInvalidada = await claveEsLaDelSeed(cuenta.passwordHash);
    if (organizationIds.length === 0 && !claveInvalidada) {
      resultados.push({ email, estado: "ya_bloqueada" });
      continue;
    }
    await almacen.aplicar({
      userId: cuenta.id,
      nuevaClave: claveInvalidada ? await hashPassword(claveAleatoria()) : null,
      organizationIds,
      at: ahora,
    });
    resultados.push({ email, estado: "bloqueada", empresas: organizationIds.length, claveInvalidada });
  }
  return resultados;
}

async function claveEsLaDelSeed(passwordHash: string) {
  try {
    return await verifyPassword(DEMO_PASSWORD, passwordHash);
  } catch {
    return false;
  }
}

function claveAleatoria() {
  return randomBytes(32).toString("base64url");
}

export function formatearDesactivacion(resultados: ResultadoDemo[]) {
  const lineas = ["Cuentas demo", ""];
  for (const resultado of resultados) {
    if (resultado.estado === "ausente") {
      lineas.push(`${resultado.email} no está en la base. No se creó ni se borró nada.`);
      continue;
    }
    if (resultado.estado === "ya_bloqueada") {
      lineas.push(`${resultado.email} ya estaba bloqueada. No se modificó.`);
      continue;
    }
    const suspension =
      resultado.empresas === 0
        ? "No hizo falta suspender de nuevo."
        : resultado.empresas === 1
          ? "Se suspendió 1 empresa."
          : `Se suspendieron ${resultado.empresas} empresas.`;
    const clave = resultado.claveInvalidada
      ? "La clave del seed quedó inservible y se cerraron las sesiones."
      : "La clave no era la del seed y se dejó igual. Se cerraron las sesiones.";
    lineas.push(`${resultado.email} quedó bloqueada. ${suspension} ${clave}`);
  }
  lineas.push("");
  lineas.push("No se borraron datos.");
  return lineas.join("\n");
}
