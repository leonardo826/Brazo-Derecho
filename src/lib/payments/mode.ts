import { flowIsConfigured } from "@/lib/flow/client";
import { mercadoPagoIsConfigured } from "@/lib/mercadopago/client";

export function flowIsTestMode() {
  if (!flowIsConfigured()) return true;
  const url = (process.env.FLOW_API_URL?.trim() || "https://sandbox.flow.cl/api").toLowerCase();
  return url.includes("sandbox");
}

export function mercadoPagoIsTestMode() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
  if (!token || !mercadoPagoIsConfigured()) return true;
  return token.startsWith("TEST-");
}
