import { publicCommit } from "@/lib/build-commit";
import { databaseAnswers } from "@/lib/health";

export const dynamic = "force-dynamic";

const SERVICE = "brazo-derecho";

export async function GET() {
  const commit = publicCommit();
  if (!(await databaseAnswers())) {
    return Response.json({ ok: false, servicio: SERVICE, base: "error", commit }, { status: 503 });
  }
  return Response.json({ ok: true, servicio: SERVICE, base: "ok", commit });
}
