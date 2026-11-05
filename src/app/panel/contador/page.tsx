import { AgentChat } from "@/components/agent-chat";
import { Flash } from "@/components/flash";
import { SubscribeActions } from "@/components/trial-button";
import { UsageBar } from "@/components/usage-bar";
import { agentIsOpen } from "@/lib/agent-access";
import { loadAgentThread, missingTable } from "@/lib/chat/store";
import { ACCOUNTING_DISCLAIMER, limitFor, modelFor } from "@/lib/catalog";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
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
  const [{ subscription, open }, usage] = await Promise.all([
    agentIsOpen(session.organizationId, "ACCOUNTING"),
    usageSnapshot(session.organizationId),
  ]);
  const limit = limitFor("ACCOUNTING", "CONSULTS");
  let migration = false;
  let messages: Awaited<ReturnType<typeof loadAgentThread>> = [];
  try {
    messages = await loadAgentThread(session.organizationId);
  } catch (error) {
    if (!missingTable(error)) throw error;
    migration = true;
  }

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
      {migration ? (
        <p className="banner error" role="alert">
          Falta la migración del chat. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : (
        <AgentChat
          open={open}
          messages={messages}
          used={usage.totals.CONSULTS}
          limit={limit}
          voice={xaiUsesNetwork() ? "xai" : "navegador"}
        />
      )}
    </>
  );
}
