import { askAccountantAction } from "@/app/actions/contador";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { ACCOUNTING_DISCLAIMER, limitFor, modelFor } from "@/lib/catalog";
import { formatWhen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { TRIAL_DAYS } from "@/lib/subscription";
import { usageSnapshot } from "@/lib/usage-store";

export const maxDuration = 300;

export default async function ContadorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [{ subscription, open }, consults, usage] = await Promise.all([
    agentIsOpen(session.organizationId, "ACCOUNTING"),
    prisma.accountingConsult.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    usageSnapshot(session.organizationId),
  ]);
  const limit = limitFor("ACCOUNTING", "CONSULTS");

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{modelFor("ACCOUNTING")}</p>
          <h1>Contador Auditor Chile</h1>
          <p className="muted">{ACCOUNTING_DISCLAIMER}</p>
        </div>
        <SubscribeActions agent="ACCOUNTING" back="/panel/contador" subscription={subscription} />
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      <UsageBar used={usage.totals.CONSULTS} limit={limit} label="Consultas de este mes" />
      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="panel-card stack">
          <h2>Tu consulta</h2>
          {open ? (
            <form action={askAccountantAction} className="stack">
              <CsrfField />
              <label>
                Pregunta contable o tributaria
                <textarea
                  name="question"
                  required
                  minLength={5}
                  maxLength={4000}
                  rows={8}
                  placeholder="¿Cuándo vence el F29 de este mes y qué pasa si lo presento atrasado?"
                />
              </label>
              <button className="button" type="submit" disabled={usage.totals.CONSULTS >= limit}>
                Consultar
              </button>
              <p className="muted">
                Revisa la normativa vigente del SII antes de responder, así que puede tardar hasta un par de minutos. No
                compartas claves del SII ni bancarias.
              </p>
            </form>
          ) : (
            <EmptyState title="Activa la prueba">Activa la prueba de {TRIAL_DAYS} días para hacer tu primera consulta.</EmptyState>
          )}
        </section>
        <section className="stack">
          {consults.length === 0 ? (
            <EmptyState title="Todavía no hay consultas">Tus preguntas y respuestas quedan guardadas aquí.</EmptyState>
          ) : null}
          {consults.map((item) => (
            <article className="panel-card" key={item.id}>
              <p className="muted">{formatWhen(item.createdAt)}</p>
              <h2>{item.question.length > 140 ? `${item.question.slice(0, 140)}…` : item.question}</h2>
              <pre className="copy">{item.answer}</pre>
              <p className="muted">{ACCOUNTING_DISCLAIMER}</p>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
