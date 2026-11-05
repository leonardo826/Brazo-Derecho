import { hideActionMarker } from "@/lib/chat/visible";

export type SensitiveAction = {
  id: "presentar_declaracion" | "pagar" | "herramienta";
  title: string;
  detail: string;
};

const TITLES: Record<SensitiveAction["id"], string> = {
  presentar_declaracion: "Presentar declaración",
  pagar: "Pagar",
  herramienta: "Herramienta de riesgo",
};

function clip(text: string, max = 500) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isPayCommand(text: string) {
  const stripped = text
    .replace(/\bse paga\b/gi, " ")
    .replace(/\bhay que pagar\b/gi, " ")
    .replace(/\bdebo pagar\b/gi, " ")
    .replace(/\btengo que pagar\b/gi, " ")
    .replace(/\bcorresponde pagar\b/gi, " ")
    .replace(/\bplazo para pagar\b/gi, " ")
    .replace(/\bfecha de pago\b/gi, " ");
  if (/\b(transfiere|transferir|transfier[ae]|abona|abonar|haz el pago|realiza el pago|realizar el pago)\b/i.test(stripped)) {
    return true;
  }
  if (/\b(puedes|podr[ií]as|quiero|necesito|por favor)\b[\s\S]{0,40}\bpag(ar|a|ue|uen|á)\b/i.test(stripped)) return true;
  if (/^\s*(¿\s*)?(paga|pagar|pague|pagá|paguen)\b/i.test(stripped)) return true;
  if (/\b(paga|pagar|pague|pagá|paguen)\b\s+(el|la|los|las|al)\b/i.test(stripped)) return true;
  return false;
}

function isFilingCommand(text: string) {
  const verb = /\b(presenta|presentar|presentes|presentá|presenten|presentad)\b/i.test(text);
  const object = /\b(declaraci[oó]n|declaraciones|f29|f22|formulario\s*29|formulario\s*22)\b/i.test(text);
  const send = /\b(env[ií]a|enviar|env[ií]es|manda|mandar|mandes)\b(?:\s+\S+){0,4}\s+(la\s+)?declaraci[oó]n\b/i.test(text);
  return (verb && object) || send;
}

function isRiskyTool(text: string) {
  if (/\b(con mi clave|usa mi clave|usando mi clave|clave del sii|clave bancaria|mi clave tributaria)\b/i.test(text)) {
    return true;
  }
  if (/\b(entra|entrar|ingresa|ingresar|inicia sesi[oó]n)\b[\s\S]{0,40}\b(al sii|a sii|al banco|a mi banco|a previred|a tesorer[ií]a)\b/i.test(text)) {
    return true;
  }
  return /\b(borra|borrar|elimina|eliminar)\b[\s\S]{0,40}\b(todo|toda la base|la base|los datos|la cuenta)\b/i.test(text);
}

export function vaultActionFor(action: string): "DECLARAR" | "PAGAR" | null {
  if (action === "presentar_declaracion") return "DECLARAR";
  if (action === "pagar") return "PAGAR";
  return null;
}

export function sensitiveRequest(text: string): SensitiveAction | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (isFilingCommand(clean)) {
    return { id: "presentar_declaracion", title: TITLES.presentar_declaracion, detail: clip(clean) };
  }
  if (isPayCommand(clean)) {
    return { id: "pagar", title: TITLES.pagar, detail: clip(clean) };
  }
  if (isRiskyTool(clean)) {
    return { id: "herramienta", title: TITLES.herramienta, detail: clip(clean) };
  }
  return null;
}

function isActionId(value: string): value is SensitiveAction["id"] {
  return value === "presentar_declaracion" || value === "pagar" || value === "herramienta";
}

export function splitAction(text: string): { text: string; action: SensitiveAction | null } {
  const visible = hideActionMarker(text);
  const marker = text.search(/ACCION_SENSIBLE\s*:/i);
  if (marker < 0) return { text: visible, action: null };
  const tail = text.slice(marker);
  const idRaw = /ACCION_SENSIBLE:\s*(presentar_declaracion|pagar|herramienta)/i.exec(tail)?.[1]?.toLowerCase() ?? "";
  if (!isActionId(idRaw)) return { text: visible, action: null };
  const title = /TITULO:\s*(.+)/i.exec(tail)?.[1]?.trim() || TITLES[idRaw];
  const detail = /DETALLE:\s*([\s\S]+)/i.exec(tail)?.[1]?.trim() || title;
  return {
    text: visible,
    action: { id: idRaw, title: title.slice(0, 140), detail: detail.slice(0, 800) },
  };
}
