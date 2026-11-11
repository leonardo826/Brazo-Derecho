import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { ComposerDraftBoundary } from "@/components/composer-draft-boundary";
import { CsrfField } from "@/components/csrf-field";
import { DemoTour, DemoTourProvider, DemoTourRestart } from "@/components/demo-tour";
import { Logo } from "@/components/logo";
import { LogoutButton } from "@/components/logout-button";
import { PanelNav } from "@/components/panel-nav";
import { CONTADOR_CONVERSATION_ID } from "@/lib/chat/composer-draft";
import type { Session } from "@/lib/session";

export function PanelShell({
  session,
  showAdmin = false,
  computerHref = null,
  children,
}: {
  session: Session;
  showAdmin?: boolean;
  computerHref?: string | null;
  children: React.ReactNode;
}) {
  return (
    <DemoTourProvider>
      <div className="panel-shell">
        <a className="skip" href="#contenido">
          Saltar al contenido
        </a>
        <aside className="panel-side">
          <div className="side-top">
            <Logo href="/panel" />
            <p className="org">{session.organizationName}</p>
          </div>
          <PanelNav showAdmin={showAdmin} computerHref={computerHref} />
          <div className="side-foot">
            <p className="whoami">
              <span>{session.name}</span>
              <span>{session.email}</span>
            </p>
            <DemoTourRestart />
            <Link href="/privacidad">Aviso de privacidad</Link>
            <form action={logoutAction}>
              <CsrfField />
              <LogoutButton />
            </form>
          </div>
        </aside>
        <main className="panel-main" id="contenido">
          <DemoTour />
          <ComposerDraftBoundary
            userId={session.userId}
            organizationId={session.organizationId}
            conversationId={CONTADOR_CONVERSATION_ID}
          >
            {children}
          </ComposerDraftBoundary>
        </main>
      </div>
    </DemoTourProvider>
  );
}
