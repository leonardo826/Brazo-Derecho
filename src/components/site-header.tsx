import Link from "next/link";
import { PublicNav } from "@/components/public-nav";

export function SiteHeader() {
  return (
    <header className="iabot-header">
      <a className="skip" href="#contenido">
        Saltar al contenido
      </a>
      <div className="iabot-wrap iabot-bar">
        <Link className="iabot-logo" href="/">
          <span className="iabot-mark" aria-hidden="true" />
          IA Bot
        </Link>
        <PublicNav />
      </div>
    </header>
  );
}
