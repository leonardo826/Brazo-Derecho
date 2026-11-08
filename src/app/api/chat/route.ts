import { requireApiSession } from "@/lib/api-session";
import { MAX_FILES, prepareUpload, type PreparedFile } from "@/lib/chat/files";
import { sseResponse } from "@/lib/chat/sse";
import { streamChatTurn } from "@/lib/chat/run";
import { loadAgentThread, missingTable } from "@/lib/chat/store";
import { sensitiveRequest } from "@/lib/chat/sensitive";
import { parseVaultPortalParam, type PortalId } from "@/lib/credentials/portal-form";
import { agentIsOpen } from "@/lib/agent-access";
import { planRoom } from "@/lib/plan-limit";
import { consumeRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function readTurn(request: Request): Promise<{ text: string; files: PreparedFile[]; portal: PortalId | null } | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  let agent = "ACCOUNTING";
  let portal: PortalId | null = null;
  const files: PreparedFile[] = [];
  if (contentType.includes("application/json")) {
    let body: { texto?: unknown; agente?: unknown; portal?: unknown };
    try {
      body = (await request.json()) as { texto?: unknown; agente?: unknown; portal?: unknown };
    } catch {
      return Response.json({ error: "datos" }, { status: 400 });
    }
    text = typeof body.texto === "string" ? body.texto.trim() : "";
    agent = typeof body.agente === "string" ? body.agente : "ACCOUNTING";
    portal = parseVaultPortalParam(body.portal);
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "datos" }, { status: 400 });
    }
    text = String(form.get("texto") ?? "").trim();
    agent = String(form.get("agente") ?? "ACCOUNTING");
    portal = parseVaultPortalParam(form.get("portal"));
    for (const item of form.getAll("archivo")) {
      if (!(item instanceof File) || item.size === 0) continue;
      if (files.length >= MAX_FILES) return Response.json({ error: "archivo" }, { status: 400 });
      const prepared = prepareUpload(item.name, new Uint8Array(await item.arrayBuffer()));
      if (!prepared) return Response.json({ error: "archivo" }, { status: 400 });
      files.push(prepared);
    }
  }
  if (agent !== "ACCOUNTING") return Response.json({ error: "datos" }, { status: 400 });
  if (text.length > 4000 || (!text && files.length === 0)) return Response.json({ error: "datos" }, { status: 400 });
  return { text, files, portal };
}

export async function GET(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  try {
    const messages = await loadAgentThread(session.organizationId);
    return Response.json({ messages });
  } catch (error) {
    if (missingTable(error)) return Response.json({ error: "migracion" }, { status: 503 });
    throw error;
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  if (!consumeRateLimit(`chat:${session.organizationId}`, 20, 10 * 60 * 1000).ok) {
    return Response.json({ error: "ritmo" }, { status: 429 });
  }
  const parsed = await readTurn(request);
  if (parsed instanceof Response) return parsed;
  const access = await agentIsOpen(session.organizationId, "ACCOUNTING");
  if (!access.open) {
    return Response.json({ error: access.suspended ? "suspendida" : "suscripcion" }, { status: 403 });
  }
  if (!sensitiveRequest(parsed.text)) {
    const room = await planRoom({
      organizationId: session.organizationId,
      checks: [{ agent: "ACCOUNTING", metric: "CONSULTS", quantity: 1 }],
    });
    if (!room.ok) return Response.json({ error: "limite" }, { status: 409 });
  }
  return sseResponse(
    (signal) =>
      streamChatTurn({
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        actorUserId: session.userId,
        text: parsed.text,
        files: parsed.files,
        portal: parsed.portal,
        signal,
      }),
    request.signal,
  );
}
