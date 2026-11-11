import { notFound } from "next/navigation";
import { decideComputerAction, enqueueComputerAction, mintComputerViewAction } from "@/app/actions/computer";
import { CsrfField } from "@/components/csrf-field";
import { Flash } from "@/components/flash";
import { computerFeatureEnabled } from "@/lib/computer/flag";
import { localNovncUrl, novncStillValid, safeNovncHref, tokenMatches } from "@/lib/computer/novnc";
import { missingVaultTable } from "@/lib/credentials/http";
import { prismaCredentialRepo } from "@/lib/credentials/repo";
import { listCredentials } from "@/lib/credentials/service";
import type { PublicCredential } from "@/lib/credentials/types";
import { Prisma, prisma } from "@/lib/prisma";
import { firstParam } from "@/lib/search";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const TASK_LABEL: Record<string, string> = {
  QUEUED: "En cola",
  RUNNING: "En curso",
  DONE: "Lista",
  FAILED: "Falló",
  PENDING_APPROVAL: "Pendiente de aprobación",
  APPROVED: "Aprobada, sin ejecutar",
  REJECTED: "Descartada",
};

function missingTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

export default async function ComputerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!computerFeatureEnabled()) notFound();
  const session = await requireSession();
  const params = await searchParams;
  const token = firstParam(params.token);
  let migration = false;
  let computer: Awaited<ReturnType<typeof prisma.computer.findUnique>> = null;
  let tasks: Awaited<ReturnType<typeof prisma.computerTask.findMany>> = [];
  let credentials: PublicCredential[] = [];
  try {
    credentials = await listCredentials(prismaCredentialRepo(), session.organizationId);
  } catch (error) {
    if (!missingVaultTable(error)) throw error;
  }
  try {
    computer = await prisma.computer.findUnique({ where: { clientId: session.organizationId } });
    tasks = computer
      ? await prisma.computerTask.findMany({
          where: { clientId: session.organizationId },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];
  } catch (error) {
    if (!missingTable(error)) throw error;
    migration = true;
  }
  const viewReady = Boolean(
    computer && token && tokenMatches(token, computer.novncTokenHash) && novncStillValid(computer.novncExpiresAt),
  );
  const localUrl = viewReady && !computer?.flyApp ? safeNovncHref(localNovncUrl()) : "";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Piloto</p>
          <h1>Mi computador</h1>
          <p className="muted">
            Cada cliente tendrá su escritorio con Chromium y WhatsApp Web. Hoy no hay máquina en Fly y no se cobra nada.
          </p>
        </div>
      </div>
      <Flash error={firstParam(params.error)} ok={firstParam(params.ok)} />
      {migration ? (
        <p className="banner error" role="alert">
          Falta la migración del computador. En local corre <code>npx prisma migrate deploy</code>.
        </p>
      ) : null}
      <article className="panel-card stack">
        <h2>Ver mi computador</h2>
        <p className="muted">
          El enlace dura 10 minutos. En local abre noVNC en tu máquina. El QR de WhatsApp lo escaneas tú; el agente no manda mensajes masivos.
        </p>
        <form action={mintComputerViewAction}>
          <CsrfField />
          <button className="button" type="submit">
            Ver mi computador
          </button>
        </form>
        {token && !viewReady ? <p className="banner error">Ese enlace de pantalla ya no sirve. Pide otro.</p> : null}
        {viewReady && token ? (
          <div className="stack">
            <p>Enlace listo hasta {computer?.novncExpiresAt?.toLocaleString("es-CL", { timeZone: "America/Santiago" })}.</p>
            {localUrl ? (
              <p>
                <a className="button-link" href={localUrl} target="_blank" rel="noreferrer">
                  Abrir noVNC local
                </a>
              </p>
            ) : (
              <p className="muted">Todavía no hay una pantalla publicada. El piloto de Fly espera la aprobación de Leonardo.</p>
            )}
            <p>
              <a href={`/api/computer/novnc?token=${encodeURIComponent(token)}`}>Estado del enlace</a>
            </p>
          </div>
        ) : null}
      </article>
      <article className="panel-card stack" style={{ marginTop: "1rem" }}>
        <h2>Pedirle algo</h2>
        <p className="muted">
          Enviar un mensaje, presentar una declaración o pagar queda pendiente. No sale nada sin tu confirmación, y en esta fase el pago y la declaración siguen apagados.
        </p>
        <form action={enqueueComputerAction} className="stack">
          <CsrfField />
          <label>
            Objetivo
            <input name="goal" maxLength={2000} placeholder="Abre https://example.com y dime qué dice" required />
          </label>
          {credentials.length ? (
            <label>
              Usar un acceso de la bóveda
              <select name="credentialId" defaultValue="">
                <option value="">No usar la bóveda</option>
                {credentials.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.portal} · {item.usernameHint}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">Si quieres que rellene un ingreso, guarda antes la clave en la bóveda. No la pegues en el objetivo.</p>
          )}
          <button className="button secondary" type="submit">
            Encolar tarea
          </button>
        </form>
        {tasks.length ? (
          <ul className="stack">
            {tasks.map((task) => (
              <li key={task.id}>
                <strong>{TASK_LABEL[task.status] ?? task.status}.</strong> {task.goal}
                {task.result ? <span className="muted"> {task.result}</span> : null}
                {task.status === "PENDING_APPROVAL" ? (
                  <form action={decideComputerAction} className="inline">
                    <CsrfField />
                    <input type="hidden" name="id" value={task.id} />
                    <button className="button small" name="decision" value="APPROVED" type="submit">
                      Aprobar
                    </button>
                    <button className="button secondary small" name="decision" value="REJECTED" type="submit">
                      Descartar
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Todavía no hay tareas.</p>
        )}
      </article>
    </>
  );
}
