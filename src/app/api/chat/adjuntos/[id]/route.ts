import { requireApiSession } from "@/lib/api-session";
import { attachmentScope } from "@/lib/chat/files";
import { attachmentHeaders, chatPreview } from "@/lib/chat/image-preview";
import { missingTable } from "@/lib/chat/store";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession(request);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  if (!id || id.length > 40) return new Response("No encontrado", { status: 404 });
  try {
    const file = await prisma.agentAttachment.findFirst({ where: attachmentScope(session.organizationId, id) });
    if (!file) return new Response("No encontrado", { status: 404 });
    const download = new URL(request.url).searchParams.get("descarga") === "1";
    const original = new Uint8Array(file.bytes);
    const body =
      download || !file.mimeType.startsWith("image/") ? { bytes: original, mimeType: file.mimeType } : await chatPreview(original, file.mimeType);
    return new Response(Buffer.from(body.bytes), {
      headers: attachmentHeaders({
        mimeType: body.mimeType,
        fileName: body.mimeType === "image/jpeg" && file.mimeType !== "image/jpeg" ? file.fileName.replace(/\.\w+$/, ".jpg") : file.fileName,
        size: body.bytes.byteLength,
        download,
      }),
    });
  } catch (error) {
    if (missingTable(error)) return new Response("No disponible", { status: 503 });
    throw error;
  }
}
