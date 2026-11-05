import Link from "next/link";
import { iabotPriceNotice, TRIAL_DAYS } from "@/lib/subscription";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap inner">
        <p>
          {iabotPriceNotice()} La prueba dura {TRIAL_DAYS} días. Con Flow conectado, el plan se cobra al terminar la
          prueba. Si Flow no está conectado, la prueba queda en el panel y no hay cargo.
        </p>
        <nav className="nav-links" aria-label="Legal">
          <Link href="/agentes">Agentes</Link>
          <Link href="/precios">Precios</Link>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <Link href="/terminos">Términos</Link>
        </nav>
      </div>
    </footer>
  );
}
