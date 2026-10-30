import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <div className="wrap inner">
        <Logo />
        <nav className="nav-links" aria-label="Principal">
          <Link href="/#agentes">Agentes</Link>
          <Link href="/#precios">Precios</Link>
          <Link href="/ingresar">Ingresar</Link>
          <Link className="button-link" href="/registro">
            Crear cuenta
          </Link>
        </nav>
      </div>
    </header>
  );
}
