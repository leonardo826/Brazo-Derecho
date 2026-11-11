"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useDemoTourHref } from "@/components/demo-tour";

const LINKS = [
  { href: "/panel", label: "Inicio" },
  { href: "/panel/whatsapp", label: "Atención WhatsApp" },
  { href: "/panel/cotizador", label: "Cotizador" },
  { href: "/panel/marketing", label: "Marketing" },
  { href: "/panel/contador", label: "Contador Auditor" },
  { href: "/panel/uso", label: "Uso del mes" },
  { href: "/panel/boveda", label: "Bóveda" },
  { href: "/panel/cuenta", label: "Cuenta" },
];

export function panelComputerHref(showComputer: boolean) {
  return showComputer ? "/panel/computador" : null;
}

export function PanelNav({ showAdmin = false, showComputer = false }: { showAdmin?: boolean; showComputer?: boolean }) {
  const pathname = usePathname();
  const tourHref = useDemoTourHref();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function center() {
      const current = nav?.querySelector<HTMLElement>("[aria-current='page']");
      if (!nav || !current) return;
      const navRect = nav.getBoundingClientRect();
      const linkRect = current.getBoundingClientRect();
      if (navRect.width < 40) return;
      if (linkRect.left >= navRect.left - 1 && linkRect.right <= navRect.right + 1) return;
      nav.scrollLeft += linkRect.left - navRect.left - (nav.clientWidth - linkRect.width) / 2;
    }
    center();
    const frame = requestAnimationFrame(center);
    const observer = new ResizeObserver(center);
    observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);
  const links = [
    ...LINKS,
    ...(showAdmin ? [{ href: "/panel/admin", label: "Administración" }] : []),
  ];
  const computerHref = panelComputerHref(showComputer);
  const computerActive = computerHref !== null && pathname.startsWith(computerHref);
  return (
    <nav className="panel-nav" aria-label="Panel" ref={navRef}>
      {links.map((link) => {
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
      {computerHref ? (
        <a href={computerHref} className={computerActive ? "active" : undefined} aria-current={computerActive ? "page" : undefined}>
          Ver mi computador
        </a>
      ) : null}
    </nav>
  );
}
