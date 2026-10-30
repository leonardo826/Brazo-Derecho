import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap inner">
        <p>
          Beta privada. Precios referenciales en pesos chilenos, netos, al 29 de octubre de 2026. El cobro con Flow y
          la boleta electrónica todavía no están conectados.
        </p>
        <nav className="nav-links" aria-label="Legal">
          <Link href="/privacidad">Privacidad</Link>
          <Link href="/terminos">Términos</Link>
        </nav>
      </div>
    </footer>
  );
}
