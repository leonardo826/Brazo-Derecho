import Link from "next/link";
import { notFound } from "next/navigation";
import { setQuoteStatusAction } from "@/app/actions/quotes";
import { Flash } from "@/components/flash";
import { formatClp, formatWhen, quoteCode } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

const STATUS_LABEL = {
  DRAFT: "Borrador",
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
};

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const quote = await prisma.quote.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { lines: { orderBy: { description: "asc" } } },
  });
  if (!quote) notFound();

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Cotización</p>
          <h1>
            {quoteCode(quote.number)} · {quote.customerName}
          </h1>
          <p className="muted">
            {STATUS_LABEL[quote.status]} · {formatWhen(quote.createdAt)}
          </p>
        </div>
        <a className="button-link secondary" href={`/panel/cotizador/${quote.id}/pdf`}>
          Descargar PDF
        </a>
      </div>
      <Flash error={firstParam(query.error)} ok={firstParam(query.ok)} />
      <article className="panel-card stack">
        <p>Aprobar no envía la cotización. La mandas tú, por el canal que uses hoy.</p>
        {quote.notes ? <p>Notas: {quote.notes}</p> : null}
        {quote.unmatchedNote ? <p>{quote.unmatchedNote}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.description}</td>
                  <td>
                    {line.quantity} {line.unit}
                  </td>
                  <td>{formatClp(line.unitPriceClp)}</td>
                  <td>{formatClp(line.quantity * line.unitPriceClp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="price">
          {formatClp(quote.totalClp)} <small>total</small>
        </p>
        {quote.agentNote ? <p className="muted">{quote.agentNote}</p> : null}
        <div className="inline">
          <form action={setQuoteStatusAction}>
            <input type="hidden" name="id" value={quote.id} />
            <input type="hidden" name="status" value="APPROVED" />
            <button className="button" type="submit">
              Aprobar
            </button>
          </form>
          <form action={setQuoteStatusAction}>
            <input type="hidden" name="id" value={quote.id} />
            <input type="hidden" name="status" value="REJECTED" />
            <button className="button secondary" type="submit">
              Rechazar
            </button>
          </form>
          <Link href="/panel/cotizador">Volver al listado</Link>
        </div>
      </article>
    </>
  );
}
