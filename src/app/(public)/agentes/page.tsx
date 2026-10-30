import type { Metadata } from "next";
import { PublicCatalog } from "@/components/public-catalog";

export const metadata: Metadata = {
  title: "Agentes",
  description: "Qué hace y qué no hace cada agente de Brazo Derecho, con su precio neto y la prueba de 14 días.",
};

export default function AgentsPage() {
  return <PublicCatalog emphasis="agentes" />;
}
