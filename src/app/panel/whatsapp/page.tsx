import Link from "next/link";
import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  sendCustomerMessageAction,
  sendHumanMessageAction,
  startConversationAction,
} from "@/app/actions/whatsapp";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { linkWhatsappNumberAction } from "@/app/actions/admin";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { AGENT_CATALOG, limitFor, modelFor } from "@/lib/catalog";
import { whatsappEnv } from "@/lib/env";
import { formatWhen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { usageSnapshot } from "@/lib/usage-store";

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const selectedId = firstParam(params.c);
  const [{ subscription, open }, knowledge, conversations, usage, organization] = await Promise.all([
    agentIsOpen(session.organizationId, "WHATSAPP"),
    prisma.knowledgeItem.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { title: "asc" },
    }),
    prisma.conversation.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    usageSnapshot(session.organizationId),
    prisma.organization.findUniqueOrThrow({ where: { id: session.organizationId } }),
  ]);
  const selected = conversations.find((item) => item.id === selectedId) ?? conversations[0];
  const messages = selected
    ? await prisma.message.findMany({
        where: { conversationId: selected.id },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const responses = usage.totals.RESPONSES;
  const responseLimit = limitFor("WHATSAPP", "RESPONSES");

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{modelFor("WHATSAPP")}</p>
          <h1>Atención WhatsApp</h1>
          <p className="muted">
            El simulador usa las mismas reglas que el canal real. Si el número está vinculado, la respuesta también sale por WhatsApp.
          </p>
        </div>
        <SubscribeActions agent="WHATSAPP" back="/panel/whatsapp" subscription={subscription} />
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {firstParam(params.guia) === "1" ? (
        <p className="banner ok">
          La prueba de 14 días quedó activa. No se cobró nada. Escribe el horario o la dirección y haz una pregunta de prueba.
        </p>
      ) : null}
      <UsageBar used={responses} limit={responseLimit} label="Respuestas de este mes" />
      <article className="panel-card stack" style={{ marginTop: "1rem" }}>
        <h2>Número de WhatsApp</h2>
        <p className="muted">
          {organization.whatsappPhoneNumberId
            ? `Este número está vinculado: ${organization.whatsappPhoneNumberId}. Los mensajes de esa línea entran a esta empresa.`
            : "Todavía no hay un número vinculado. Puedes seguir probando en el simulador."}
        </p>
        {session.role === "OWNER" ? (
          <form action={linkWhatsappNumberAction} className="stack">
            <CsrfField />
            <label>
              Id del número en Meta
              <input
                name="whatsappPhoneNumberId"
                inputMode="numeric"
                pattern="\d{8,20}"
                defaultValue={organization.whatsappPhoneNumberId ?? ""}
                placeholder="Solo dígitos, como los muestra Meta"
              />
            </label>
            <p className="muted">Déjalo vacío y guarda para desvincularlo.</p>
            <button className="button secondary" type="submit">
              Guardar número
            </button>
          </form>
        ) : (
          <p className="muted">El dueño de la empresa puede vincular el número.</p>
        )}
        {whatsappEnv().phoneNumberId ? (
          <p className="muted">Id de referencia configurado en el servidor: {whatsappEnv().phoneNumberId}.</p>
        ) : null}
      </article>
      {!open ? (
        <article className="panel-card" style={{ marginTop: "1rem" }}>
          <h2>Activa la prueba para atender</h2>
          <p>Son 14 días de prueba. El agente solo responde con la información que cargues aquí.</p>
          <ul className="plain no">
            {AGENT_CATALOG.WHATSAPP.doesNot.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ) : (
        <div className="grid-2" style={{ marginTop: "1rem" }}>
          <section className="panel-card stack">
            <h2>Base de conocimiento</h2>
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
                  <button className="button secondary small" type="submit">
                    Eliminar
                  </button>
                </form>
              </article>
            ))}
          </section>
          <section className="panel-card stack">
            <h2>{selected?.channel === "whatsapp" ? "WhatsApp" : "Simulador"}</h2>
            <form action={startConversationAction} className="inline">
              <CsrfField />
              <label style={{ flex: 1 }}>
                Quién escribe
                <input name="customerLabel" required minLength={2} maxLength={80} placeholder="Cliente del mesón" />
              </label>
              <button className="button secondary" type="submit">
                Abrir hilo
              </button>
            </form>
            {conversations.length > 0 ? (
              <div className="inline">
                {conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    className={conversation.id === selected?.id ? "button-link small" : "button-link small secondary"}
                    href={`/panel/whatsapp?c=${conversation.id}`}
                  >
                    {conversation.customerLabel}
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="Todavía no hay conversaciones">
                Abre un hilo con el nombre de quien escribe y haz una pregunta que esté en tus fichas.
              </EmptyState>
            )}
            {selected ? (
              <>
                <div className="thread" aria-live="polite">
                  {messages.length === 0 ? <p className="muted">Sin mensajes todavía.</p> : null}
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`bubble ${message.role === "CUSTOMER" ? "customer" : message.role === "HUMAN" ? "human" : "agent"}`}
                    >
                      <span className="who">
                        {message.role === "CUSTOMER" ? selected.customerLabel : message.role === "HUMAN" ? "Persona del equipo" : "Agente"}
                        {message.refused ? " · rechazó" : ""}
                        {message.escalated ? " · derivó" : ""}
                      </span>
                      <p>{message.body}</p>
                      <p className="muted">{formatWhen(message.createdAt)}</p>
                    </div>
                  ))}
                </div>
                <form action={sendCustomerMessageAction} className="stack">
                  <CsrfField />
                  <input type="hidden" name="conversationId" value={selected.id} />
                  <label>
                    Mensaje del cliente
                    <textarea name="body" required maxLength={2000} placeholder="Escribe la consulta del cliente" autoComplete="off" disabled={responses >= responseLimit} />
                  </label>
                  <button className="button" type="submit" disabled={responses >= responseLimit}>
                    Pedir respuesta
                  </button>
                </form>
                <form action={sendHumanMessageAction} className="stack">
                  <CsrfField />
                  <input type="hidden" name="conversationId" value={selected.id} />
                  <label>
                    Respuesta de una persona
                    <textarea name="body" required maxLength={2000} placeholder="Te confirmo el despacho para mañana." />
                  </label>
                  <button className="button secondary" type="submit">
                    Anotar respuesta humana
                  </button>
                </form>
              </>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
