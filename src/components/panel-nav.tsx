"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDemoTourHref } from "@/components/demo-tour";

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
  const tourHref = useDemoTourHref();
  return (
    <nav className="panel-nav" aria-label="Panel">
      {[...LINKS, ...(showAdmin ? [{ href: "/panel/admin", label: "Administración" }] : [])].map((link) => {
        const active = link.href === "/panel" ? pathname === "/panel" : pathname.startsWith(link.href);
        const onTour = tourHref === link.href;
        const className = [active ? "active" : "", onTour ? "tour-target" : ""].filter(Boolean).join(" ");
        return (
          <Link
            key={link.href}
            href={link.href}
            className={className || undefined}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
