export const PORTAL_IDS = ["sii", "previred", "tesoreria"] as const;

export type PortalId = (typeof PORTAL_IDS)[number];

export type PortalPreset = {
  id: PortalId;
  portal: string;
  label: string;
  usernameLabel: string;
  usernamePlaceholder: string;
};

export const PORTAL_PRESETS: Record<PortalId, PortalPreset> = {
  sii: {
    id: "sii",
    portal: "SII",
    label: "Clave SII",
    usernameLabel: "Usuario / RUT",
    usernamePlaceholder: "12.345.678-9",
  },
  previred: {
    id: "previred",
    portal: "Previred",
    label: "Clave Previred",
    usernameLabel: "Usuario",
    usernamePlaceholder: "",
  },
  tesoreria: {
    id: "tesoreria",
    portal: "Tesorería",
    label: "Clave Tesorería",
    usernameLabel: "Usuario / RUT",
    usernamePlaceholder: "12.345.678-9",
  },
};

export function parseVaultPortalParam(value: unknown): PortalId | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const id = raw.trim().toLowerCase();
  if (id === "sii" || id === "previred" || id === "tesoreria") return id;
  return null;
}

export function portalPresetById(id: PortalId | null): PortalPreset | null {
  return id ? PORTAL_PRESETS[id] : null;
}

/** Solo el id del portal. Nunca un secreto, una URL externa ni un redirect. */
export function vaultFormPath(id: PortalId | null) {
  if (!id) return "/panel/boveda#agregar-acceso";
  return `/panel/boveda?portal=${id}#agregar-acceso`;
}

export function portalPresetFromText(text: string): PortalId | null {
  if (/\bprevired\b/i.test(text)) return "previred";
  if (/\btesorer/i.test(text)) return "tesoreria";
  if (/\bsii\b|impuestos internos/i.test(text)) return "sii";
  return null;
}

export function askedToDeleteChatSecret(text: string) {
  return /\b(borr\w*|elimin\w*)\b/i.test(text) && /\b(clave|contrase(?:ñ|n)a|chat|mensaje)\b/i.test(text);
}

export function vaultFormMessage(id: PortalId | null, text = "") {
  const preset = id ? PORTAL_PRESETS[id] : null;
  const href = vaultFormPath(id);
  const title = preset ? `Abrir formulario seguro de ${preset.portal}` : "Abrir formulario seguro";
  const rut = preset?.usernameLabel.includes("RUT") ? " El RUT va en Usuario / RUT." : "";
  const erase = askedToDeleteChatSecret(text) ? " Borrar el mensaje del chat no quita las copias." : "";
  return `Ingresa el usuario y la clave en el formulario protegido: [${title}](${href}).${rut} La clave va en el campo Clave, enmascarado, con consentimiento. No las escribas en este chat. Guardarlas no inicia sesión. No entré al portal.${erase}`;
}
