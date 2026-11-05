import type { Metadata } from "next";
import { PublicCatalog } from "@/components/public-catalog";
import { TRIAL_DAYS } from "@/lib/subscription";

export const metadata: Metadata = {
  title: "Agentes",
  description: `Qué hace y qué no hace cada agente de Brazo Derecho, con su precio neto y la prueba de ${TRIAL_DAYS} días.`,
};

export default function AgentsPage() {
  return <PublicCatalog emphasis="agentes" />;
}
