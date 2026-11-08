import { saveComputerLease } from "@/lib/computer/lease";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await resolveSession();
  if (!session) return Response.json({ ok: false, error: "sesion" }, { status: 401 });
  if (!consumeRateLimit(`computer-lease:${session.organizationId}`, 10, 60_000).ok) {
    return Response.json({ ok: false, error: "ritmo" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "datos" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { machineId?: unknown; endpoint?: unknown; token?: unknown }) : {};
  const saved = await saveComputerLease({
    organizationId: session.organizationId,
    machineId: typeof record.machineId === "string" ? record.machineId : "",
    endpoint: typeof record.endpoint === "string" ? record.endpoint : "",
    token: typeof record.token === "string" ? record.token : "",
  });
  if (!saved.ok) return Response.json({ ok: false, error: saved.error }, { status: saved.error === "boveda_sin_clave" ? 503 : 400 });
  return Response.json({ ok: true, configured: true, machineId: saved.machineId });
}
