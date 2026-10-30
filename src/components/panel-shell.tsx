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
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="panel-side">
        <div className="side-top">
          <Logo href="/panel" />
          <p className="org">{session.organizationName}</p>
        </div>
        <PanelNav showAdmin={showAdmin} />
        <div className="side-foot">
          <p className="whoami">
            <span>{session.name}</span>
            <span>{session.email}</span>
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
      <main className="panel-main" id="contenido">
        {children}
      </main>
    </div>
  );
}
