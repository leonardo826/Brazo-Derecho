import { notFound } from "next/navigation";
import { linkWhatsappNumberAction, setOrganizationSuspensionAction } from "@/app/actions/admin";
import { CsrfField } from "@/components/csrf-field";
import { EmptyState } from "@/components/empty-state";
import { Flash } from "@/components/flash";
import { isPlatformAdmin } from "@/lib/admin";
import { AGENT_CATALOG, AGENT_ORDER, METRIC_LABEL, type MetricId } from "@/lib/catalog";
import { whatsappEnv } from "@/lib/env";
import { formatClp } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { subscriptionView } from "@/lib/subscription";
import { usageByOrganization } from "@/lib/usage-store";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!isPlatformAdmin(session.email)) notFound();
  const params = await searchParams;
  const organizations = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    include: {
      subscriptions: true,
      memberships: {
        where: { role: "OWNER" },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });
  const usage = await usageByOrganization(organizations.map((organization) => organization.id));
  const referenceId = whatsappEnv().phoneNumberId;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Empresas</h1>
          <p className="muted">
            Uso y costo estimado de {usage.label}, estado de cada suscripción y suspensión. Suspender detiene los agentes y conserva los datos.
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {organizations.length === 0 ? (
        <EmptyState title="Todavía no hay empresas">Cuando alguien cree una cuenta, aparece en esta lista.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Dueño</th>
                <th>Suscripciones</th>
                <th>Uso del mes</th>
                <th>Costo estimado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => {
                const owner = organization.memberships[0]?.user;
                const summary = usage.byOrganization.get(organization.id);
                const tokens = summary
                  ? summary.byModel["grok-4.3"].inputTokens +
                    summary.byModel["grok-4.3"].outputTokens +
                    summary.byModel["grok-4.7"].inputTokens +
                    summary.byModel["grok-4.7"].outputTokens
                  : 0;
                return (
                  <tr key={organization.id}>
                    <td>
                      <strong>{organization.name}</strong>
                      <br />
                      <span className="muted">
                        {organization.whatsappPhoneNumberId
                          ? `WhatsApp ${organization.whatsappPhoneNumberId}`
                          : "Sin número de WhatsApp"}
                      </span>
                    </td>
                    <td>
                      {owner ? (
                        <>
                          {owner.name}
                          <br />
                          <span className="muted">{owner.email}</span>
                        </>
                      ) : (
                        "Sin dueño"
                      )}
                    </td>
                    <td>
                      {AGENT_ORDER.map((agent) => {
                        const subscription = organization.subscriptions.find((item) => item.agent === agent);
                        const view = subscriptionView(subscription);
                        return (
                          <div key={agent}>
                            {AGENT_CATALOG[agent].name}: {view.label}
                          </div>
                        );
                      })}
                    </td>
                    <td>
                      {(["RESPONSES", "QUOTES", "TEXTS", "IMAGES"] as MetricId[]).map((metric) => (
                        <div key={metric}>
                          {METRIC_LABEL[metric]}: {(summary?.totals[metric] ?? 0).toLocaleString("es-CL")}
                        </div>
                      ))}
                      <span className="muted">{tokens.toLocaleString("es-CL")} tokens de entrada y salida</span>
                    </td>
                    <td>{formatClp(summary?.costClp ?? 0)}</td>
                    <td>
                      <p>{organization.suspendedAt ? "Suspendida" : "Al día"}</p>
                      <form action={setOrganizationSuspensionAction}>
                        <CsrfField />
                        <input type="hidden" name="organizationId" value={organization.id} />
                        <input type="hidden" name="suspended" value={organization.suspendedAt ? "0" : "1"} />
                        <button className={organization.suspendedAt ? "button small" : "button secondary small"} type="submit">
                          {organization.suspendedAt ? "Reactivar" : "Suspender"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form action={linkWhatsappNumberAction} className="panel-card stack" style={{ marginTop: "1rem" }}>
        <CsrfField />
        <h2>Vincular WhatsApp</h2>
        <p className="muted">
          El id es el que muestra Meta. Los mensajes de ese número llegan solo al agente de la empresa elegida.
          {referenceId ? ` Id de referencia en el servidor: ${referenceId}.` : ""}
        </p>
        {organizations.length === 0 ? (
          <p>Cuando exista una empresa, puedes vincular su número aquí.</p>
        ) : (
          <>
            <label>
              Empresa
              <select name="organizationId" required defaultValue={organizations[0]?.id ?? ""}>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Id del número
              <input name="whatsappPhoneNumberId" inputMode="numeric" placeholder="Solo dígitos" />
            </label>
            <p className="muted">Si dejas el id vacío, se desvincula la empresa elegida.</p>
            <button className="button" type="submit">
              Guardar vínculo
            </button>
          </>
        )}
      </form>
    </>
  );
}
