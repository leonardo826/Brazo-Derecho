import { forgetAllMemoryAction, forgetMemoryAction } from "@/app/actions/memory";
import { CsrfField } from "@/components/csrf-field";
import { missingTable } from "@/lib/chat/store";
import { formatWhen } from "@/lib/format";
import { memoryFeatureEnabled } from "@/lib/memory/flag";
import { listMemoryForAgent, type MemoryListItem } from "@/lib/memory/service";
import type { AgentKind } from "@/lib/prisma";

export function AgentMemoryPanel({
  agent,
  facts,
  expanded,
  missing = false,
}: {
  agent: AgentKind;
  facts: MemoryListItem[];
  expanded: boolean;
  missing?: boolean;
}) {
  return (
    <details className="panel-card stack memory-panel" open={expanded || undefined}>
      <summary>
        Lo que el agente recuerda
        {facts.length > 0 ? ` (${facts.length})` : ""}
      </summary>
      <p className="muted">
        Datos de tu empresa que este agente guarda para las próximas conversaciones. No guardamos claves, contraseñas,
        números de tarjeta ni llaves. Si borras un dato, se elimina de verdad: el texto sale de la base y el agente deja
        de usarlo. Puedes pedir lo mismo por la Ley 19.628 y la Ley 21.719.
      </p>
      {missing ? (
        <p className="banner error" role="alert">
          Falta la migración de la memoria. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : null}
      {!missing && facts.length === 0 ? (
        <p>Todavía no hay datos guardados. El agente anota el nombre, el RUT, el rubro, los productos, las preferencias y el tono.</p>
      ) : null}
      {facts.length > 0 ? (
        <ul className="memory-list">
          {facts.map((fact) => (
            <li className="memory-fact" key={fact.id}>
              <div>
                <p>{fact.text}</p>
                <p className="muted">
                  {fact.scope === "empresa" ? "De la empresa" : "De este agente"} · {formatWhen(fact.createdAt)}
                </p>
              </div>
              <form action={forgetMemoryAction}>
                <CsrfField />
                <input type="hidden" name="agente" value={agent} />
                <input type="hidden" name="id" value={fact.id} />
                <button className="button secondary small" type="submit" aria-label={`Borrar: ${fact.text}`}>
                  Borrar
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      {facts.length > 0 ? (
        <form action={forgetAllMemoryAction} className="stack">
          <CsrfField />
          <input type="hidden" name="agente" value={agent} />
          <p className="muted">Borrar todo saca estos datos, incluidos los de la empresa que también usan los otros agentes.</p>
          <button className="button secondary" type="submit">
            Borrar todo
          </button>
        </form>
      ) : null}
    </details>
  );
}

export async function AgentMemory({ organizationId, agent }: { organizationId: string; agent: AgentKind }) {
  if (!memoryFeatureEnabled()) return null;
  let facts: MemoryListItem[] = [];
  let missing = false;
  try {
    facts = await listMemoryForAgent(organizationId, agent);
  } catch (error) {
    if (!missingTable(error)) throw error;
    missing = true;
  }
  return <AgentMemoryPanel agent={agent} facts={facts} expanded={agent !== "ACCOUNTING"} missing={missing} />;
}
