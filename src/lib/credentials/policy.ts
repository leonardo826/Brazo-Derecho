import { isDeclarationGoal, isHighRiskGoal, isPaymentGoal } from "../../../agent-runtime/src/sensitive";
import type { CredentialMeta, RiskAction } from "@/lib/credentials/types";

export { isDeclarationGoal, isHighRiskGoal, isPaymentGoal };

const LOGIN_ASK = [
  /inici(ar|a)\s+sesi[oó]n/i,
  /entra(r)?\s+(a|al|en)\b/i,
  /\blog\s?in\b/i,
  /con mi clave/i,
  /con la clave/i,
  /usa(r)? (la |mi )?(credencial|clave)/i,
  /b[oó]veda/i,
  /rellena(r)? (el |la )?(acceso|login|clave|formulario)/i,
  /llena(r)? (el |la )?(acceso|login|clave|formulario)/i,
];

export function clientAskedForLogin(goal: string) {
  return LOGIN_ASK.some((pattern) => pattern.test(goal));
}

export function explicitVaultAsk(goal: string, credentialId?: string) {
  return Boolean(credentialId) || /b[oó]veda|credencial/i.test(goal);
}

export function riskActionOf(purpose: string): RiskAction | null {
  const declaration = isDeclarationGoal(purpose);
  const payment = isPaymentGoal(purpose);
  if (declaration === payment) return null;
  if (declaration) return "DECLARAR";
  return "PAGAR";
}

export function isHighRiskPurpose(purpose: string) {
  return purpose === "declarar" || purpose === "pagar" || isHighRiskGoal(purpose);
}

export function metadataForModel(rows: CredentialMeta[]): CredentialMeta[] {
  return rows.slice(0, 20).map((row) => ({
    id: row.id,
    label: row.label,
    portal: row.portal,
    usernameHint: row.usernameHint,
  }));
}
