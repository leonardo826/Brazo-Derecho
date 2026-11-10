import Link from "next/link";
import { iabotPriceNotice, TRIAL_DAYS } from "@/lib/subscription";

export function SiteFooter() {
  return (
    <footer className="iabot-footer">
      <div className="iabot-wrap iabot-bar">
        <p>IA Bot</p>
        <nav aria-label="Legal">
          <Link href="/agentes">Agentes</Link>
          <Link href="/precios">Precios</Link>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <Link href="/terminos">Términos</Link>
        </nav>
      </div>
      <div className="iabot-wrap">
        <p className="iabot-foot-note">
          {iabotPriceNotice()} La prueba dura {TRIAL_DAYS} días. Con Flow conectado, el plan se cobra al terminar la
          prueba. Si Flow no está conectado, la prueba queda en el panel y no hay cargo.
        </p>
      </div>
    </footer>
  );
}
