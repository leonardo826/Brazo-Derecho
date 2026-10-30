import { logoutAction } from "@/app/actions/auth";
import { Logo } from "@/components/logo";
import { PanelNav } from "@/components/panel-nav";
import type { Session } from "@/lib/session";

export function PanelShell({ session, children }: { session: Session; children: React.ReactNode }) {
  return (
    <div className="panel-shell">
      <aside className="panel-side">
        <Logo href="/panel" />
        <p className="org">{session.organizationName}</p>
        <PanelNav />
        <div className="side-foot">
          <p className="whoami">
            {session.name}
            <br />
            {session.email}
          </p>
          <form action={logoutAction}>
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
