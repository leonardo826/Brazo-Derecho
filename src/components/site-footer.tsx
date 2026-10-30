import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap inner">
        <p>
          Precios en pesos chilenos, netos, más IVA. La prueba dura 14 días. Con Flow conectado, el plan se cobra al
          terminar la prueba. Si Flow no está conectado, la prueba queda en el panel y no hay cargo.
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
