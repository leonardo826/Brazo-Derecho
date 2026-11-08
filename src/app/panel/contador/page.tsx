import { AgentChat } from "@/components/agent-chat";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { agentIsOpen } from "@/lib/agent-access";
import { loadAgentThread, missingTable } from "@/lib/chat/store";
import { ACCOUNTING_DISCLAIMER, limitFor } from "@/lib/catalog";
import { tasksToday } from "@/lib/meter-store";
import { organizationIsQa } from "@/lib/qa-account";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { DAILY_TASK_LIMIT } from "@/lib/usage";
import { usageSnapshot } from "@/lib/usage-store";
import { xaiUsesNetwork } from "@/lib/xai/client";

export const maxDuration = 300;

export default async function ContadorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [{ subscription, open }, usage, qa] = await Promise.all([
    agentIsOpen(session.organizationId, "ACCOUNTING"),
    usageSnapshot(session.organizationId),
    organizationIsQa(session.organizationId),
  ]);
  const tasks = qa ? null : await tasksToday(session.organizationId);
  const limit = limitFor("ACCOUNTING", "CONSULTS");
  let migration = false;
  let messages: Awaited<ReturnType<typeof loadAgentThread>> = [];
  try {
    messages = await loadAgentThread(session.organizationId);
  } catch (error) {
    if (!missingTable(error)) throw error;
    migration = true;
  }

  const used = usage.totals.CONSULTS;

  return (
    <div className="contador-screen">
      <header className="contador-bar">
        <div className="contador-title">
          <h1>Contador Auditor Chile</h1>
          <p className="contador-meta">
            <span
              className="sr-only"
              role="meter"
              aria-label="Consultas de este mes"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={used}
              aria-valuetext={`${used} de ${limit} consultas del mes`}
            >
              {used} de {limit} consultas del mes
            </span>
            <span className="contador-quota">
              {qa ? "Revisión interna, sin tope diario" : `${tasks} de ${DAILY_TASK_LIMIT} tareas hoy`}
            </span>
            <span className="contador-dot" aria-hidden="true">
              ·
            </span>
            <span>{ACCOUNTING_DISCLAIMER}</span>
          </p>
        </div>
        {open ? null : (
          <div className="contador-plan">
            <SubscribeActions agent="ACCOUNTING" back="/panel/contador" subscription={subscription} />
          </div>
        )}
      </header>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {migration ? (
        <p className="banner error" role="alert">
          Falta la migración del chat. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : (
        <AgentChat
          open={open}
          messages={messages}
          used={used}
          limit={limit}
          voice={xaiUsesNetwork() ? "xai" : "navegador"}
          draftScope={session.organizationId}
        />
      )}
    </div>
  );
}
