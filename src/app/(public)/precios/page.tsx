import type { Metadata } from "next";
import { PublicCatalog } from "@/components/public-catalog";

export const metadata: Metadata = {
  title: "Precios",
  description: "Atención WhatsApp, Cotizador y Marketing en pesos chilenos, netos, más IVA, con prueba de 14 días.",
};

export default function PricesPage() {
  return <PublicCatalog emphasis="precios" />;
}
