export type DesktopAction =
  | { type: "click"; x: number; y: number; button: "left" | "right" }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number }
  | { type: "goto"; url: string }
  | { type: "fill"; credentialId: string };

const KEYS: Record<string, string> = {
  Return: "Return",
  Enter: "Return",
  BackSpace: "BackSpace",
  Tab: "Tab",
  Escape: "Escape",
  Up: "Up",
  Down: "Down",
  Left: "Left",
  Right: "Right",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  Page_Up: "Page_Up",
  Page_Down: "Page_Down",
  F5: "F5",
  "ctrl+l": "ctrl+l",
  "ctrl+a": "ctrl+a",
  "ctrl+t": "ctrl+t",
};

export function parseHttpUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function asInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

export function parseAction(input: unknown): { ok: true; action: DesktopAction } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "La acción tiene que ser un objeto." };
  const raw = input as Record<string, unknown>;
  if (raw.type === "click") {
    const x = asInt(raw.x);
    const y = asInt(raw.y);
    if (x === null || y === null || x < 0 || y < 0 || x > 1920 || y > 1200) {
      return { ok: false, error: "El click necesita x e y dentro de la pantalla." };
    }
    return { ok: true, action: { type: "click", x, y, button: raw.button === "right" ? "right" : "left" } };
  }
  if (raw.type === "type") {
    if (typeof raw.text !== "string" || raw.text.length < 1 || raw.text.length > 400) {
      return { ok: false, error: "El texto tiene que tener entre 1 y 400 caracteres." };
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw.text)) {
      return { ok: false, error: "El texto trae caracteres de control." };
    }
    return { ok: true, action: { type: "type", text: raw.text } };
  }
  if (raw.type === "key") {
    const key = typeof raw.key === "string" ? KEYS[raw.key] : undefined;
    if (!key) return { ok: false, error: "Esa tecla no está permitida." };
    return { ok: true, action: { type: "key", key } };
  }
  if (raw.type === "scroll") {
    const dy = asInt(raw.dy);
    if (dy === null || dy === 0 || dy < -10 || dy > 10) {
      return { ok: false, error: "El scroll usa dy entre -10 y 10, distinto de cero." };
    }
    return { ok: true, action: { type: "scroll", dy } };
  }
  if (raw.type === "goto") {
    if (typeof raw.url !== "string") return { ok: false, error: "Falta la URL." };
    const url = parseHttpUrl(raw.url);
    if (!url) return { ok: false, error: "La URL tiene que ser http o https, sin usuario ni clave." };
    return { ok: true, action: { type: "goto", url } };
  }
  if (raw.type === "fill") {
    const credentialId = typeof raw.credentialId === "string" ? raw.credentialId.trim() : "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(credentialId)) {
      return { ok: false, error: "Falta el id de la credencial." };
    }
    return { ok: true, action: { type: "fill", credentialId } };
  }
  return { ok: false, error: "Acción desconocida. Usa click, type, key, scroll, goto o fill." };
}

export function xdotoolArgs(action: Exclude<DesktopAction, { type: "goto" | "fill" }>) {
  if (action.type === "click") {
    return ["mousemove", "--sync", String(action.x), String(action.y), "click", action.button === "right" ? "3" : "1"];
  }
  if (action.type === "type") return ["type", "--delay", "20", "--clearmodifiers", "--", action.text];
  if (action.type === "key") return ["key", "--clearmodifiers", action.key];
  const button = action.dy > 0 ? "5" : "4";
  return ["click", "--repeat", String(Math.abs(action.dy)), button];
}

export function describeAction(action: DesktopAction) {
  if (action.type === "goto") return `goto ${action.url}`;
  if (action.type === "click") return `click ${action.x},${action.y}`;
  if (action.type === "type") return `type ${action.text.length} caracteres`;
  if (action.type === "key") return `key ${action.key}`;
  if (action.type === "fill") return `fill ${action.credentialId}`;
  return `scroll ${action.dy}`;
}
