import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { CsrfField } from "@/components/csrf-field";
import { Logo } from "@/components/logo";
import { PanelNav } from "@/components/panel-nav";
import type { Session } from "@/lib/session";

export function PanelShell({
  session,
  showAdmin = false,
  children,
}: {
  session: Session;
  showAdmin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="panel-shell">
      <aside className="panel-side">
        <Logo href="/panel" />
        <p className="org">{session.organizationName}</p>
        <PanelNav showAdmin={showAdmin} />
        <div className="side-foot">
          <p className="whoami">
            {session.name}
            <br />
            {session.email}
          </p>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <form action={logoutAction}>
            <CsrfField />
            <button className="button ghost" type="submit">
              Salir
            </button>
          </form>
        </div>
      </aside>
      <div className="panel-main" id="contenido">
        {children}
      </div>
    </div>
  );
}
