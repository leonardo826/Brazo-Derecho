import Link from "next/link";
import {
  createPriceAction,
  togglePriceAction,
  updatePriceAction,
} from "@/app/actions/quotes";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { QuoteForm } from "@/components/quote-form";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { limitFor, modelFor } from "@/lib/catalog";
import { formatClp, quoteCode } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

const STATUS_LABEL = {
  DRAFT: "Borrador",
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
};

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [{ subscription, open }, prices, quotes, usage] = await Promise.all([
    agentIsOpen(session.organizationId, "QUOTES"),
    prisma.priceItem.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.quote.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    usageSnapshot(session.organizationId),
  ]);
  const active = prices.filter((item) => item.active);
  const quoteLimit = limitFor("QUOTES", "QUOTES");

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{modelFor("QUOTES")}</p>
          <h1>Cotizador</h1>
          <p className="muted">Los precios salen solo de esta lista. La cotización no se envía sola.</p>
        </div>
        <SubscribeActions agent="QUOTES" back="/panel/cotizador" subscription={subscription} />
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {firstParam(params.guia) === "1" ? (
        <p className="banner ok">
          La prueba de 14 días quedó activa. No se cobró nada. Agrega un producto con su precio neto y arma una cotización de prueba.
        </p>
      ) : null}
      <UsageBar used={usage.totals.QUOTES} limit={quoteLimit} label="Cotizaciones de este mes" />

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="panel-card stack">
          <h2>Lista de precios</h2>
          <form action={createPriceAction} className="stack" autoComplete="off">
            <CsrfField />
            <div className="split">
              <label>
                SKU
                <input name="sku" required maxLength={40} placeholder="SKU-01" autoComplete="off" />
              </label>
              <label>
                Precio neto CLP
                <input name="priceClp" type="number" required min={1} max={100000000} placeholder="1990" autoComplete="off" />
              </label>
            </div>
            <div className="split">
              <label>
                Nombre
                <input name="name" required minLength={2} maxLength={160} placeholder="Nombre del producto" autoComplete="off" />
              </label>
              <label>
                Unidad
                <input name="unit" required maxLength={40} placeholder="unidad" autoComplete="off" />
              </label>
            </div>
            <button className="button" type="submit">
              Agregar a la lista
            </button>
          </form>
          {prices.length === 0 ? (
            <EmptyState title="Todavía no hay productos">
              Agrega el primero con su precio neto. Sin lista, el cotizador no arma nada y no inventa valores.
            </EmptyState>
          ) : null}
          {prices.map((item) => (
            <form key={item.id} action={updatePriceAction} className="stack">
              <CsrfField />
              <input type="hidden" name="id" value={item.id} />
              <div className="split">
                <label>
                  SKU
                  <input name="sku" required defaultValue={item.sku} />
                </label>
                <label>
                  Precio
                  <input name="priceClp" type="number" required min={1} defaultValue={item.priceClp} />
                </label>
              </div>
              <div className="split">
                <label>
                  Nombre
                  <input name="name" required defaultValue={item.name} />
                </label>
                <label>
                  Unidad
                  <input name="unit" required defaultValue={item.unit} />
                </label>
              </div>
              <div className="inline">
                <span className={item.active ? "badge good" : "badge warn"}>{item.active ? "Activo" : "Pausado"}</span>
                <span>{formatClp(item.priceClp)}</span>
                <button className="button small" type="submit">
                  Guardar
                </button>
              </div>
              <button className="button secondary small" type="submit" formAction={togglePriceAction}>
                {item.active ? "Pausar" : "Activar"}
              </button>
            </form>
          ))}
        </section>
        <section className="stack">
          <article className="panel-card stack">
            <h2>Nueva cotización</h2>
            {open ? (
              active.length === 0 ? (
                <EmptyState title="Falta un producto activo">Agrega al menos uno a la lista antes de cotizar.</EmptyState>
              ) : usage.totals.QUOTES >= quoteLimit ? (
                <p>Llegaste a las {quoteLimit.toLocaleString("es-CL")} cotizaciones de este mes.</p>
              ) : (
                <QuoteForm
                  items={active.map((item) => ({
                    id: item.id,
                    label: `${item.name} · ${formatClp(item.priceClp)}`,
                  }))}
                />
              )
            ) : (
              <p>Activa la prueba para armar cotizaciones. No hay cobro en la beta.</p>
            )}
          </article>
          <article className="panel-card">
            <h2>Cotizaciones</h2>
            {quotes.length === 0 ? (
              <EmptyState title="Todavía no hay cotizaciones">
                Cuando armes una, queda pendiente de tu aprobación. Brazo Derecho no la envía.
              </EmptyState>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <Link href={`/panel/cotizador/${quote.id}`}>{quoteCode(quote.number)}</Link>
                      </td>
                      <td>{quote.customerName}</td>
                      <td>{STATUS_LABEL[quote.status]}</td>
                      <td>{formatClp(quote.totalClp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
