import { requireApiSession } from "@/lib/api-session";
import { attachmentScope, safeFileName } from "@/lib/chat/files";
import { missingTable } from "@/lib/chat/store";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  if (!id || id.length > 40) return new Response("No encontrado", { status: 404 });
  try {
    const file = await prisma.agentAttachment.findFirst({ where: attachmentScope(session.organizationId, id) });
    if (!file) return new Response("No encontrado", { status: 404 });
    const inline = file.mimeType.startsWith("image/");
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeFileName(file.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (missingTable(error)) return new Response("No disponible", { status: 503 });
    throw error;
  }
}
