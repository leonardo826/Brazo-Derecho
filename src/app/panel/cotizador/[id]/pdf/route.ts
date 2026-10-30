import { renderQuotePdf } from "@/lib/pdf/quote";
import { prisma } from "@/lib/prisma";
import { quoteCode } from "@/lib/format";
import { resolveSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (!session) return new Response("No autorizado", { status: 401 });
  const { id } = await context.params;
  const quote = await prisma.quote.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { lines: true, organization: true },
  });
  if (!quote) return new Response("No encontrada", { status: 404 });
  const pdf = await renderQuotePdf({
    number: quote.number,
    customerName: quote.customerName,
    notes: quote.notes,
    unmatchedNote: quote.unmatchedNote,
    status: quote.status,
    totalClp: quote.totalClp,
    createdAt: quote.createdAt,
    organization: { name: quote.organization.name, rut: quote.organization.rut },
    lines: quote.lines,
  });
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quoteCode(quote.number)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
