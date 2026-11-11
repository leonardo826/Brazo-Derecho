import {
  createKnowledgeAction,
  deleteKnowledgeAction,
} from "@/app/actions/whatsapp";
import { AgentChat } from "@/components/agent-chat";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { chatSurface } from "@/lib/chat/agents";
import { loadAgentThread, missingTable } from "@/lib/chat/store";
import { AGENT_CATALOG, limitFor, modelFor } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { TRIAL_DAYS } from "@/lib/subscription";
import { usageSnapshot } from "@/lib/usage-store";
import { xaiUsesNetwork } from "@/lib/xai/client";

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [{ subscription, open }, knowledge, usage] = await Promise.all([
    agentIsOpen(session.organizationId, "WHATSAPP"),
    prisma.knowledgeItem.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { title: "asc" },
    }),
    usageSnapshot(session.organizationId),
  ]);
  const responses = usage.totals.RESPONSES;
  const responseLimit = limitFor("WHATSAPP", "RESPONSES");
  const surface = chatSurface("WHATSAPP");
  let migration = false;
  let messages: Awaited<ReturnType<typeof loadAgentThread>> = [];
  try {
    messages = await loadAgentThread(session.organizationId, "WHATSAPP");
  } catch (error) {
    if (!missingTable(error)) throw error;
    migration = true;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{modelFor("WHATSAPP")}</p>
          <h1>Atención WhatsApp</h1>
          <p className="muted">
            Prueba de atención en esta pantalla, con los datos de tu empresa. Todavía no hay conexión a WhatsApp.
          </p>
        </div>
        <SubscribeActions agent="WHATSAPP" back="/panel/whatsapp" subscription={subscription} />
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {firstParam(params.guia) === "1" ? (
        <p className="banner ok">
          La prueba de {TRIAL_DAYS} días quedó activa. No se cobra nada durante la prueba. Escribe el horario o la dirección y haz una pregunta de prueba.
        </p>
      ) : null}
      <UsageBar used={responses} limit={responseLimit} label="Respuestas de este mes" />
      {!open ? (
        <article className="panel-card" style={{ marginTop: "1rem" }}>
          <h2>Activa la prueba para atender</h2>
          <p>Son {TRIAL_DAYS} días de prueba. El agente solo responde con la información que cargues aquí.</p>
          <ul className="plain no">
            {AGENT_CATALOG.WHATSAPP.doesNot.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ) : null}
      {migration ? (
        <p className="banner error" role="alert">
          Falta la migración del chat. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : (
        <div className="agent-desk">
          <AgentChat
            agent="WHATSAPP"
            open={open}
            messages={messages}
            used={responses}
            limit={responseLimit}
            voice={xaiUsesNetwork() ? "xai" : "navegador"}
            suggestions={surface.suggestions}
            emptyIntro={surface.emptyIntro}
            placeholder={surface.placeholder}
            ariaLabel={surface.ariaLabel}
            limitNote={surface.limitNote}
            draftUserId={session.userId}
            draftOrganizationId={session.organizationId}
            draftConversationId={surface.conversationId}
          />
        </div>
      )}
      {open ? (
        <section className="panel-card stack" style={{ marginTop: "1rem" }}>
          <h2>Datos de la empresa</h2>
          <p className="muted">Horarios, dirección, despachos, medios de pago. Si no está escrito, el agente no lo inventa.</p>
          <form action={createKnowledgeAction} className="stack">
            <CsrfField />
            <label>
              Título
              <input name="title" required minLength={3} maxLength={120} placeholder="Título de la ficha" autoComplete="off" />
            </label>
            <label>
              Texto que puede usar
              <textarea name="body" required minLength={3} maxLength={2000} placeholder="El dato exacto que el agente puede repetir." autoComplete="off" />
            </label>
            <button className="button" type="submit">
              Guardar ficha
            </button>
          </form>
          {knowledge.length === 0 ? (
            <EmptyState title="Todavía no hay fichas">
              Parte por el horario y la dirección. El agente solo repite lo que escribas aquí y no inventa el resto.
            </EmptyState>
          ) : null}
          {knowledge.map((item) => (
            <article key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <form action={deleteKnowledgeAction}>
                <CsrfField />
                <input type="hidden" name="id" value={item.id} />
                <button className="button secondary small" type="submit" aria-label={`Eliminar ${item.title}`}>
                  Eliminar
                </button>
              </form>
            </article>
          ))}
        </section>
      ) : null}
    </>
  );
}
