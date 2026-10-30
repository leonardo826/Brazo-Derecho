export const DEMO_TOUR_STORAGE_KEY = "brazo-prueba-demo";
export const DEMO_TOUR_STEP_KEY = "brazo-prueba-demo-paso";

export type DemoTourStep = {
  href: string;
  kicker: string;
  title: string;
  body: string;
};

export const DEMO_TOUR_STEPS: readonly DemoTourStep[] = [
  {
    href: "/panel",
    kicker: "Paso 1 de 5",
    title: "Prueba la demo",
    body: "En un minuto ves dónde probar cada agente. Ciérralo cuando quieras: no vuelve a salir solo. Nada se cobra y no sale ningún mensaje a un celular.",
  },
  {
    href: "/panel",
    kicker: "Paso 2 de 5",
    title: "Tres agentes, por separado",
    body: "Acá están Atención WhatsApp, el Cotizador y Marketing. Cada uno tiene su prueba de 14 días y su cupo. Los abres cuando quieras.",
  },
  {
    href: "/panel/whatsapp",
    kicker: "Paso 3 de 5",
    title: "Atiende como en el mesón",
    body: "Escribe una ficha, abre un hilo y pregunta como el cliente. La respuesta queda en esta pantalla: no llega a un celular.",
  },
  {
    href: "/panel/cotizador",
    kicker: "Paso 4 de 5",
    title: "Arma una cotización",
    body: "Carga un producto con su precio neto y arma la cotización. Queda pendiente: tú la revisas. No se envía sola ni inventa precios.",
  },
  {
    href: "/panel/marketing",
    kicker: "Paso 5 de 5",
    title: "Deja un borrador listo",
    body: "Prepara un texto para tu negocio. No se publica. En Uso del mes ves el cupo que llevas. Con eso ya puedes probar la demo.",
  },
];

export function demoTourPathMatches(href: string, pathname: string) {
  if (href === "/panel") return pathname === "/panel";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function demoTourStepIndex(raw: string | null) {
  const step = Number(raw);
  if (!Number.isInteger(step) || step < 0 || step >= DEMO_TOUR_STEPS.length) return 0;
  return step;
}
