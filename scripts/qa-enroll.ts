import { qaEnrollConfigured, qaEnrollLogLine } from "../src/lib/computer/qa-enroll-gate";

async function main() {
  const mode = qaEnrollConfigured(process.env);
  if (mode === "skip") return 0;
  if (mode === "partial") {
    process.stdout.write(`${qaEnrollLogLine("-", false)}\n`);
    return 1;
  }
  const { runQaEnroll } = await import("../src/lib/computer/qa-enroll");
  try {
    return await runQaEnroll(process.env, {
      log: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } finally {
    try {
      const { prisma } = await import("../src/lib/prisma");
      await prisma.$disconnect();
    } catch {
      // No se imprime el fallo: puede arrastrar un valor del entorno.
    }
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch(async () => {
    process.stdout.write(`${qaEnrollLogLine("-", false)}\n`);
    try {
      const { prisma } = await import("../src/lib/prisma");
      await prisma.$disconnect();
    } catch {
      // No se imprime el fallo: puede arrastrar un valor del entorno.
    }
    process.exit(1);
  });
