import { confirmRiskAction, createCredentialAction, deleteCredentialAction } from "@/app/actions/boveda";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { missingVaultTable } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { listAudit, listCredentials } from "@/lib/credentials/service";
import type { AuditEvent, PublicCredential } from "@/lib/credentials/types";
import { formatWhen } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AuditEvent["kind"], string> = {
  CREATE: "Alta",
  DELETE: "Eliminación",
  USE: "Uso",
  CONFIRM: "Confirmación",
};

const PURPOSE_LABEL: Record<string, string> = {
  alta: "Guardar el acceso",
  eliminar: "Eliminar el acceso",
  login: "Rellenar un ingreso",
  declarar: "Presentar una declaración",
  pagar: "Pagar",
};

function purposeLabel(purpose: string) {
  return PURPOSE_LABEL[purpose] ?? "Uso del acceso";
}

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  let migration = false;
  let credentials: PublicCredential[] = [];
  let events: AuditEvent[] = [];
  let names = new Map<string, string>();
  try {
    const [listed, audit, members] = await Promise.all([
      listCredentials(prismaCredentialRepo(), session.organizationId),
      listAudit(prismaCredentialRepo(), session.organizationId),
      prisma.membership.findMany({
        where: { organizationId: session.organizationId },
        include: { user: true },
      }),
    ]);
    credentials = listed;
    events = audit;
    names = new Map(members.map((member) => [member.userId, member.user.name]));
  } catch (error) {
    if (!missingVaultTable(error)) throw error;
    migration = true;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Accesos</p>
          <h1>Bóveda de claves</h1>
          <p className="muted">
            Aquí guardas los accesos de {session.organizationName}: SII, bancos y otros portales. La clave queda cifrada y no se muestra de nuevo.
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {migration ? (
        <p className="banner error" role="alert">
          Falta la migración de la bóveda. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : null}

      <article className="panel-card stack">
        <h2>Qué aceptas al guardar</h2>
        <div className="stack">
          <p>
            <strong>Qué se guarda.</strong> El nombre del acceso, el portal o sitio, una pista del usuario (los últimos 4 caracteres) y la clave cifrada. En la lista no aparece la clave ni el usuario completo.
          </p>
          <p>
            <strong>Cifrado.</strong> Se usa AES-256-GCM. La llave maestra vive solo en el servidor, en la variable <code>CREDENTIALS_MASTER_KEY</code> de Vercel. No está en el código, no se muestra en esta pantalla y no sale en las respuestas.
          </p>
          <p>
            <strong>El modelo de IA.</strong> La clave no se manda como texto al modelo ni entra en los prompts de xAI. El asistente solo puede ver el identificador, el nombre, el portal y la pista del usuario.
          </p>
          <p>
            <strong>Cuándo se usa.</strong> Solo cuando tú pides ese ingreso o esa tarea. Puedes eliminar un acceso cuando quieras: se borra la clave cifrada y queda el registro de la eliminación, sin el secreto.
          </p>
          <p>
            <strong>Declaraciones y pagos.</strong> Presentar declaraciones y pagar siempre piden una confirmación tuya en este panel, aunque la clave ya esté guardada. Guardar la clave no autoriza esas acciones.
          </p>
        </div>
      </article>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <form action={createCredentialAction} className="panel-card stack">
          <CsrfField />
          <h2>Agregar acceso</h2>
          <label>
            Nombre
            <input name="label" required minLength={2} maxLength={80} placeholder="Clave SII" autoComplete="off" />
          </label>
          <label>
            Portal o sitio
            <input name="portal" required minLength={2} maxLength={120} placeholder="SII" autoComplete="off" />
          </label>
          <label>
            Usuario
            <input name="username" required maxLength={160} autoComplete="off" placeholder="12.345.678-9" />
          </label>
          <label>
            Clave
            <input name="secret" type="password" required minLength={4} maxLength={400} autoComplete="off" />
          </label>
          <p className="muted">Después de guardar, la clave no se vuelve a mostrar.</p>
          <label className="check">
            <input name="consent" type="checkbox" required />
            <span>Acepto guardar esta clave en la bóveda de mi empresa, con el cifrado y los límites de arriba.</span>
          </label>
          <button className="button" type="submit">
            Guardar en la bóveda
          </button>
        </form>

        <article className="panel-card stack">
          <h2>Accesos guardados</h2>
          {credentials.length ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Accesos de la bóveda">
              <table>
                <caption className="sr-only">Accesos guardados, sin claves.</caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Portal</th>
                    <th scope="col">Usuario</th>
                    <th scope="col">Guardado</th>
                    <th scope="col">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {credentials.map((item) => (
                    <tr key={item.id}>
                      <td>{item.label}</td>
                      <td>{item.portal}</td>
                      <td>{item.usernameHint}</td>
                      <td>{formatWhen(item.createdAt)}</td>
                      <td>
                        <form action={deleteCredentialAction}>
                          <CsrfField />
                          <input type="hidden" name="id" value={item.id} />
                          <button className="button secondary small" type="submit">
                            Eliminar
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Todavía no guardas accesos.</p>
          )}
        </article>
      </div>

      <article className="panel-card stack" style={{ marginTop: "1rem" }}>
        <h2>Confirmar una acción de riesgo</h2>
        <p>
          Sin esta confirmación no se puede usar la clave para presentar una declaración ni para pagar. Cada confirmación dura 15 minutos, queda en el registro y vale solo para esa acción.
        </p>
        <p className="muted">
          El piloto del computador sigue sin ejecutar el pago ni el envío de la declaración. Confirmar no manda plata ni manda el trámite.
        </p>
        <div className="grid-2">
          <form action={confirmRiskAction} className="stack">
            <CsrfField />
            <input type="hidden" name="action" value="DECLARAR" />
            <label className="check">
              <input name="confirmed" type="checkbox" required />
              <span>Confirmo que quiero presentar una declaración.</span>
            </label>
            <button className="button secondary" type="submit">
              Confirmar declaración
            </button>
          </form>
          <form action={confirmRiskAction} className="stack">
            <CsrfField />
            <input type="hidden" name="action" value="PAGAR" />
            <label className="check">
              <input name="confirmed" type="checkbox" required />
              <span>Confirmo que quiero pagar.</span>
            </label>
            <button className="button secondary" type="submit">
              Confirmar pago
            </button>
          </form>
        </div>
      </article>

      <article className="panel-card stack" style={{ marginTop: "1rem" }}>
        <h2>Registro</h2>
        <p className="muted">Quién usó o eliminó un acceso, y para qué. No incluye claves.</p>
        {events.length ? (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Registro de la bóveda">
            <table>
              <caption className="sr-only">Registro de usos y eliminaciones, sin secretos.</caption>
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Qué pasó</th>
                  <th scope="col">Acceso</th>
                  <th scope="col">Para qué</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Quién</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatWhen(event.createdAt)}</td>
                    <td>{KIND_LABEL[event.kind]}</td>
                    <td>{event.credentialLabel || "—"}</td>
                    <td>{purposeLabel(event.purpose)}</td>
                    <td>{event.success ? "Listo" : "No se pudo"}</td>
                    <td>{names.get(event.actorUserId) ?? "Otra persona de la empresa"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Todavía no hay movimientos.</p>
        )}
      </article>
    </>
  );
}
