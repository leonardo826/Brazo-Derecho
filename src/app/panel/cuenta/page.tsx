import { updateOrganizationAction } from "@/app/actions/account";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { formatWhen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const [organization, members] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: session.organizationId } }),
    prisma.membership.findMany({
      where: { organizationId: session.organizationId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Cuenta</p>
          <h1>{organization.name}</h1>
          <p className="muted">En la beta, la empresa parte con quien crea la cuenta. No hay invitaciones todavía.</p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      <div className="grid-2">
        <form action={updateOrganizationAction} className="panel-card stack">
          <CsrfField />
          <h2>Datos de la empresa</h2>
          <label>
            Nombre
            <input name="organizationName" required minLength={2} maxLength={120} defaultValue={organization.name} />
          </label>
          <label>
            RUT
            <input name="rut" maxLength={20} defaultValue={organization.rut ?? ""} placeholder="76.123.456-0" />
          </label>
          <p className="muted">Identificador interno: {organization.slug}</p>
          {members.find((member) => member.userId === session.userId)?.user.consentAt ? (
            <p className="muted">
              Aceptaste los términos y el aviso de privacidad el{" "}
              {formatWhen(members.find((member) => member.userId === session.userId)!.user.consentAt!)}.
            </p>
          ) : (
            <p className="muted">Esta cuenta no tiene fecha de aceptación del aviso de privacidad.</p>
          )}
          <button className="button" type="submit">
            Guardar
          </button>
        </form>
        <article className="panel-card">
          <h2>Personas con acceso</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.user.name}</td>
                    <td>{member.user.email}</td>
                    <td>{member.role === "OWNER" ? "Dueño" : "Equipo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </>
  );
}
