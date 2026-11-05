import type { Metadata } from "next";
import { PublicCatalog } from "@/components/public-catalog";
import { TRIAL_DAYS } from "@/lib/subscription";

export const metadata: Metadata = {
  title: "Precios",
  description: `Atención WhatsApp, Cotizador y Marketing en pesos chilenos, netos, más IVA, con prueba de ${TRIAL_DAYS} días.`,
};

export default function PricesPage() {
  return <PublicCatalog emphasis="precios" />;
}
