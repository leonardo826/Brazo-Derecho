import "dotenv/config";
import type { createPrismaClient } from "../src/lib/prisma";
import { desactivarCuentasDemo, formatearDesactivacion, type AlmacenDemo, type BloqueoPendiente } from "../src/lib/demo-cuentas";

function almacen(prisma: ReturnType<typeof createPrismaClient>): AlmacenDemo {
  return {
    async buscar(email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          passwordHash: true,
          memberships: {
            select: { organization: { select: { id: true, suspendedAt: true } } },
          },
        },
      });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        organizations: user.memberships.map((membership) => membership.organization),
      };
    },
    async aplicar(bloqueo: BloqueoPendiente) {
      await prisma.$transaction(async (tx) => {
        if (bloqueo.organizationIds.length > 0) {
          await tx.organization.updateMany({
            where: { id: { in: bloqueo.organizationIds }, suspendedAt: null },
            data: { suspendedAt: bloqueo.at },
          });
        }
        await tx.user.update({
          where: { id: bloqueo.userId },
          data: bloqueo.nuevaClave
            ? { passwordHash: bloqueo.nuevaClave, authVersion: { increment: 1 } }
            : { authVersion: { increment: 1 } },
        });
      });
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Falta DATABASE_URL. No se modificó la base.");
    process.exitCode = 1;
    return;
  }
  const { createPrismaClient } = await import("../src/lib/prisma");
  const prisma = createPrismaClient();
  try {
    const resultados = await desactivarCuentasDemo(almacen(prisma));
    console.log(formatearDesactivacion(resultados));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error("No se pudieron bloquear las cuentas demo. No se borró nada: revisa DATABASE_URL y vuelve a correr el script.");
  process.exitCode = 1;
});
