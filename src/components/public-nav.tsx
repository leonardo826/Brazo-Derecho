"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/agentes", label: "Agentes" },
  { href: "/precios", label: "Precios" },
  { href: "/ingresar", label: "Ingresar" },
];

export function PublicNav() {
  const pathname = usePathname();
  return (
    <nav className="nav-links" aria-label="Principal">
      {LINKS.map((link) => {
        const current = pathname === link.href;
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
      <Link className="button-link" href="/registro" aria-current={pathname === "/registro" ? "page" : undefined}>
        Crear cuenta
      </Link>
    </nav>
  );
}
