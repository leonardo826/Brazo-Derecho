import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, servicio: "brazo-derecho" });
  } catch {
    return Response.json({ ok: false, servicio: "brazo-derecho" }, { status: 503 });
  }
}
