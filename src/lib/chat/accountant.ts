import { instructionsFor } from "@/lib/catalog";
import type { CredentialMeta } from "@/lib/credentials/types";

const BLOCKS = [
  "no presenta declaraciones ni hace trámites en el sii",
  "no pide claves del sii",
  "no pides ni guardas claves",
  "entrar con una clave",
  "no entres al sii y no uses claves",
  "no puedo ingresar al sitio del sii",
  "no pido, recibo ni uso claves",
  "no uso claves",
];

export function promptBlocksVaultLogin(text: string) {
  const hay = text.toLowerCase();
  return BLOCKS.some((phrase) => hay.includes(phrase));
}

export function accountantChatInstructions(organizationName: string) {
  return [
    instructionsFor("ACCOUNTING", organizationName),
    "Estás en un chat continuo con la persona dueña de la empresa. Usa el hilo anterior y responde en markdown simple, sin HTML.",
    "Por defecto responde en una o dos frases, en español de Chile. Solo alarga si piden detalle, un cálculo o el fundamento legal completo.",
    "Si piden entrar a un portal (SII, ventas, F29, Previred o Tesorería) y la Bóveda tiene la credencial, el computador entra con fill y credentialId. Tú solo ves id, nombre, portal y pista de usuario.",
    "Si no hay credencial para ese portal, ofrece guardarla en /panel/boveda. No rechaces el ingreso.",
    "Declarar o pagar exige confirmación explícita del cliente, en el hilo o en la Bóveda por 15 minutos. No lo ejecutes sin eso.",
    "Si te piden presentar una declaración, pagar, transferir o borrar datos, no lo hagas en el acto.",
    "En ese caso cierra la respuesta con estas tres líneas y nada después:",
    "ACCION_SENSIBLE: presentar_declaracion | pagar | herramienta",
    "TITULO: título corto",
    "DETALLE: qué borrador quedaría, sin decir que ya se presentó o se pagó.",
    "Si alguien pega una clave en el chat, no la repitas. Pídele que la guarde en la Bóveda.",
    "No inventes claves. No recomiendes evasión, facturas falsas ni documentos falsos.",
    "No menciones Grok, xAI ni el nombre de un modelo.",
  ].join("\n");
}

export const APPROVED_PORTAL_NOTE =
  "La persona aprobó preparar el borrador. No declares ni pagues. Si hace falta mirar un portal, usa la credencial de la Bóveda con fill y credentialId. Si no hay credencial, indica /panel/boveda. No inventes claves ni las repitas. Responde en una o dos frases.";

export function portalName(text: string) {
  if (/\bprevired\b/i.test(text)) return "Previred";
  if (/\btesorer/i.test(text)) return "Tesorería";
  return "SII";
}

function portalMatches(goal: string, portal: string) {
  const asked = goal.toLowerCase();
  const name = portal.toLowerCase();
  if (name && asked.includes(name)) return true;
  if (/\bsii\b|impuestos internos/.test(asked) && /\bsii\b|impuestos internos/.test(name)) return true;
  if (/\bprevired\b/.test(asked) && /previred/.test(name)) return true;
  if (/\btesorer/.test(asked) && /tesorer/.test(name)) return true;
  if (/\bbanco\b/.test(asked) && /banco/.test(name)) return true;
  return false;
}

export function pickPortalCredential(goal: string, rows: CredentialMeta[]) {
  const usable = rows.filter((row) => row.id && row.label && row.portal);
  if (!usable.length) return null;
  const matched = usable.filter(
    (row) => portalMatches(goal, row.portal) || (row.label.length >= 3 && goal.toLowerCase().includes(row.label.toLowerCase())),
  );
  if (matched.length >= 1) return matched[0];
  if (usable.length === 1 && /\b(b[oó]veda|mi clave|la clave)\b/i.test(goal)) return usable[0];
  return null;
}

function toPortal(portal: string) {
  return /^sii$/i.test(portal.trim()) ? "al SII" : `a ${portal}`;
}

export function vaultScreenMessage(portal = "SII") {
  return `Para entrar ${toPortal(portal)} guarda la clave en la [Bóveda](/panel/boveda). Queda cifrada y yo la uso sin verla.`;
}

export function fillQueuedMessage(row: CredentialMeta) {
  const hint = row.usernameHint ? `, usuario ${row.usernameHint}` : "";
  return `Dejé en cola el ingreso ${toPortal(row.portal)} con «${row.label}» de la Bóveda${hint}. La clave no se muestra.`;
}

export function fillDoneMessage(row: CredentialMeta) {
  const hint = row.usernameHint ? `, usuario ${row.usernameHint}` : "";
  return `Entré ${toPortal(row.portal)} con «${row.label}» de la Bóveda${hint}. La clave no se mostró.`;
}

export function fillFailedMessage(row: CredentialMeta) {
  return `No pude abrir el computador para entrar ${toPortal(row.portal)}. La clave «${row.label}» sigue en la [Bóveda](/panel/boveda).`;
}

export function fillNeedsConfirmationMessage(row: CredentialMeta) {
  return `Para seguir en ${row.portal} necesito tu confirmación. La clave «${row.label}» sigue en la [Bóveda](/panel/boveda).`;
}

export function fillUnavailableMessage(row: CredentialMeta) {
  return `No pude abrir «${row.label}» ahora. Entra a la [Bóveda](/panel/boveda) para confirmar el acceso.`;
}

export type PortalPlan =
  | { kind: "fill"; credential: CredentialMeta; message: string }
  | { kind: "vault"; message: string };

export function planPortalAccess(goal: string, rows: CredentialMeta[]): PortalPlan {
  const credential = pickPortalCredential(goal, rows);
  if (!credential) return { kind: "vault", message: vaultScreenMessage(portalName(goal)) };
  return { kind: "fill", credential, message: fillQueuedMessage(credential) };
}

export function vaultContext(rows: CredentialMeta[]) {
  if (!rows.length) {
    return "Bóveda: no hay accesos guardados. No inventes claves ni pidas que las peguen en el chat. Ofrece guardarlas en /panel/boveda.";
  }
  const lines = rows.map(
    (row) => `- id ${row.id}: ${row.label} (${row.portal})${row.usernameHint ? `, usuario ${row.usernameHint}` : ""}`,
  );
  return ["Bóveda (solo id, nombre, portal y pista de usuario; nunca la clave):", ...lines, "Para entrar, el computador usa fill con credentialId."].join(
    "\n",
  );
}
