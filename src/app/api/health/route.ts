import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SERVICE = "brazo-derecho";

async function databaseAnswers() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = prisma.$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 2_000);
  });
  try {
    return await Promise.race([query, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  if (!(await databaseAnswers())) {
    return Response.json({ ok: false, servicio: SERVICE, base: "error" }, { status: 503 });
  }
  return Response.json({ ok: true, servicio: SERVICE, base: "ok" });
}
