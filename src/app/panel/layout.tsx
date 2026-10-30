import { PanelShell } from "@/components/panel-shell";
import { VerifyBanner } from "@/components/verify-banner";
import { isPlatformAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const admin = isPlatformAdmin(session.email);
  const [organization, user] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { suspendedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { emailVerifiedAt: true },
    }),
  ]);
  const suspended = Boolean(organization?.suspendedAt);
  return (
    <PanelShell session={session} showAdmin={admin}>
      {user?.emailVerifiedAt ? null : <VerifyBanner />}
      {suspended && admin ? (
        <p className="banner error">Tu empresa está suspendida. Como administración igual puedes revisar el panel.</p>
      ) : null}
      {suspended && !admin ? (
        <article className="panel-card stack">
          <p className="eyebrow">Cuenta</p>
          <h1>Empresa suspendida</h1>
          <p>
            Los agentes de {session.organizationName} están detenidos. Tus datos siguen guardados. Cuando administración reactive la empresa, puedes volver a usarlos.
          </p>
        </article>
      ) : (
        children
      )}
    </PanelShell>
  );
}
