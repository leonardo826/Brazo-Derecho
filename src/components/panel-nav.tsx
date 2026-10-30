"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/panel", label: "Inicio" },
  { href: "/panel/whatsapp", label: "Atención WhatsApp" },
  { href: "/panel/cotizador", label: "Cotizador" },
  { href: "/panel/marketing", label: "Marketing" },
  { href: "/panel/uso", label: "Uso del mes" },
  { href: "/panel/cuenta", label: "Cuenta" },
];

export function PanelNav({ showAdmin = false }: { showAdmin?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="panel-nav" aria-label="Panel">
      {[...LINKS, ...(showAdmin ? [{ href: "/panel/admin", label: "Administración" }] : [])].map((link) => {
        const active = link.href === "/panel" ? pathname === "/panel" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
