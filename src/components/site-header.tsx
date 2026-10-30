import { Logo } from "@/components/logo";
import { PublicNav } from "@/components/public-nav";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <div className="wrap inner">
        <Logo />
        <PublicNav />
      </div>
    </header>
  );
}
