import { requireApiSession } from "@/lib/api-session";
import { chatSurface, isChatAgent, type ChatAgentId } from "@/lib/chat/agents";
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

async function readTurn(
  request: Request,
): Promise<{ text: string; files: PreparedFile[]; portal: PortalId | null; agent: ChatAgentId } | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  let agent: ChatAgentId = "ACCOUNTING";
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
    const requested = typeof body.agente === "string" ? body.agente : "ACCOUNTING";
    if (!isChatAgent(requested)) return Response.json({ error: "datos" }, { status: 400 });
    agent = requested;
    portal = parseVaultPortalParam(body.portal);
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "datos" }, { status: 400 });
    }
    text = String(form.get("texto") ?? "").trim();
    const requested = String(form.get("agente") ?? "ACCOUNTING");
    if (!isChatAgent(requested)) return Response.json({ error: "datos" }, { status: 400 });
    agent = requested;
    portal = parseVaultPortalParam(form.get("portal"));
    for (const item of form.getAll("archivo")) {
      if (!(item instanceof File) || item.size === 0) continue;
      if (files.length >= MAX_FILES) return Response.json({ error: "archivo" }, { status: 400 });
      const prepared = prepareUpload(item.name, new Uint8Array(await item.arrayBuffer()));
      if (!prepared) return Response.json({ error: "archivo" }, { status: 400 });
      files.push(prepared);
    }
  }
  if (text.length > 4000 || (!text && files.length === 0)) return Response.json({ error: "datos" }, { status: 400 });
  return { text, files, portal, agent };
}

export async function GET(request: Request) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  try {
    const requested = new URL(request.url).searchParams.get("agente") ?? "ACCOUNTING";
    if (!isChatAgent(requested)) return Response.json({ error: "datos" }, { status: 400 });
    const messages = await loadAgentThread(session.organizationId, requested);
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
  const sensitive = sensitiveRequest(parsed.text);
  const surface = chatSurface(parsed.agent);
  const [access, room] = await Promise.all([
    agentIsOpen(session.organizationId, parsed.agent),
    sensitive
      ? Promise.resolve({ ok: true as const })
      : planRoom({
          organizationId: session.organizationId,
          checks: [{ agent: parsed.agent, metric: surface.metric, quantity: 1 }],
        }),
  ]);
  if (!access.open) {
    return Response.json({ error: access.suspended ? "suspendida" : "suscripcion" }, { status: 403 });
  }
  if (!room.ok) return Response.json({ error: "limite" }, { status: 409 });
  return sseResponse(
    (signal) =>
      streamChatTurn({
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        actorUserId: session.userId,
        text: parsed.text,
        files: parsed.files,
        portal: parsed.portal,
        agent: parsed.agent,
        signal,
      }),
    request.signal,
  );
}
