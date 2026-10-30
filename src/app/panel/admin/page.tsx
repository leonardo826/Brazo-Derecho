import { notFound } from "next/navigation";
import { linkWhatsappNumberAction } from "@/app/actions/admin";
import { Flash } from "@/components/flash";
import { isPlatformAdmin } from "@/lib/admin";
import { whatsappEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";
import { subscriptionView } from "@/lib/subscription";

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
    include: { subscriptions: true },
  });
  const referenceId = whatsappEnv().phoneNumberId;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Números de WhatsApp</h1>
          <p className="muted">
            Vincula cada empresa con el id de número que muestra Meta. Los mensajes de ese id llegan solo al agente de esa empresa.
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {referenceId ? <p className="muted">Id de referencia en el servidor: {referenceId}.</p> : null}
      {organizations.length === 0 ? <p>Todavía no hay empresas.</p> : null}
      {organizations.length > 0 ? (
        <form action={linkWhatsappNumberAction} className="panel-card stack">
          <h2>Vincular</h2>
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
        </form>
      ) : null}
      <div className="table-wrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Id del número</th>
              <th>Atención WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => {
              const subscription = organization.subscriptions.find((item) => item.agent === "WHATSAPP");
              const view = subscriptionView(subscription);
              return (
                <tr key={organization.id}>
                  <td>{organization.name}</td>
                  <td>{organization.whatsappPhoneNumberId ?? "Sin vínculo"}</td>
                  <td>{view.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
