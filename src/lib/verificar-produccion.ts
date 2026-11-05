/**
 * Chequeo de solo lectura del checklist «antes de abrir el cobro».
 * No crea cobros, suscripciones ni usuarios, no llama a xAI y no usa secretos.
 * Los POST de prueba traen una firma inválida o un cuerpo sin tópico, para que
 * el servidor rechace antes de consultar a un proveedor o escribir en la base.
 */

export const DEMO_ACCOUNTS = ["maria@losaromos.cl", "pedro@cafedelpuerto.cl"] as const;

/** La misma clave que imprime `prisma/seed.ts`. No es un secreto de producción. */
export const DEMO_PASSWORD = "Clave-demo-2026";

const ID_SONDEO = "verificacion-solo-lectura";
const TS_VENCIDO = "1000000000";
const FIRMA_FALSA = "0".repeat(64);
const USER_AGENT = "brazo-derecho-verificar/1";
const ESPERA_MS = 20_000;
const CUERPO_MAX = 500_000;

export const TEXTO_AYUDA = [
  "Uso: npm run verificar:produccion -- --url https://tu-dominio",
  "",
  "Revisa, en solo lectura, el checklist de antes de abrir el cobro.",
  "Por defecto usa APP_URL. No crea cobros, usuarios ni suscripciones,",
  "no escribe en la base, no llama a xAI y no necesita secretos.",
  "",
  "Código de salida: 0 si no hay fallas críticas, 1 si hay alguna,",
  "2 si la URL o los argumentos no sirven. Una advertencia deja el código en 0.",
].join("\n");

export type Nivel = "pasa" | "falla" | "advertencia";

export type Chequeo = {
  id: string;
  titulo: string;
  nivel: Nivel;
  detalle: string;
};

export type Encabezados = Record<string, string[]>;

export type RespuestaSondeo =
  | { ok: true; status: number; body: string; headers: Encabezados; location: string | null }
  | { ok: false; error: string };

export type Ingreso =
  | { email: string; resultado: "rechazada" }
  | { email: string; resultado: "entro" }
  | { email: string; resultado: "no_concluyente"; motivo: string };

export type Sondeo = {
  url: string;
  salud: RespuestaSondeo;
  mercadoPagoSinFirma: RespuestaSondeo;
  mercadoPagoTsVencido: RespuestaSondeo;
  flow: RespuestaSondeo;
  whatsappPost: RespuestaSondeo;
  whatsappGet: RespuestaSondeo;
  cabeceras: RespuestaSondeo;
  ingreso: RespuestaSondeo;
  panel: RespuestaSondeo;
  terminos: RespuestaSondeo;
  privacidad: RespuestaSondeo;
  observabilidad: RespuestaSondeo;
  cuentas: Ingreso[];
};

export type Cli = { tipo: "url"; url: string } | { tipo: "ayuda" } | { tipo: "error"; mensaje: string };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const fetchReal: FetchLike = (url, init) => fetch(url, init);

export function leerAppUrl(texto: string) {
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const match = limpia.match(/^(?:export\s+)?APP_URL\s*=\s*(.*)$/);
    if (!match) continue;
    const valor = valorEnv(match[1] ?? "");
    return valor || undefined;
  }
  return undefined;
}

function valorEnv(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end > 1 ? trimmed.slice(1, end) : "";
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    return end > 1 ? trimmed.slice(1, end) : "";
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

export function resolverCli(argv: string[], appUrl: string | undefined): Cli {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 1 && esAyuda(args[0] ?? "")) return { tipo: "ayuda" };

  let explicita: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (esAyuda(arg)) return { tipo: "ayuda" };
    if (arg === "--url") {
      const valor = args[index + 1];
      if (!valor || valor.startsWith("--")) return { tipo: "error", mensaje: "Falta el valor de --url." };
      if (explicita) return { tipo: "error", mensaje: "Pasa una sola URL." };
      explicita = valor;
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      if (explicita) return { tipo: "error", mensaje: "Pasa una sola URL." };
      explicita = arg.slice("--url=".length);
      continue;
    }
    return { tipo: "error", mensaje: `No entiendo el argumento ${arg}. Usa --url https://tu-dominio o --ayuda.` };
  }

  const cruda = (explicita ?? appUrl ?? "").trim();
  if (!cruda) {
    return { tipo: "error", mensaje: "Falta la URL. Pásala con --url https://tu-dominio o define APP_URL." };
  }
  return validarOrigen(cruda);
}

function esAyuda(arg: string) {
  return arg === "--ayuda" || arg === "--help" || arg === "-h";
}

function validarOrigen(cruda: string): Cli {
  let url: URL;
  try {
    url = new URL(cruda);
  } catch {
    return { tipo: "error", mensaje: "La URL no se pudo leer. Ejemplo: https://brazo-derecho.vercel.app" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { tipo: "error", mensaje: "La URL tiene que ser http o https." };
  }
  if (url.username || url.password) {
    return { tipo: "error", mensaje: "La URL no puede llevar usuario ni clave." };
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return {
      tipo: "error",
      mensaje: "La URL tiene que ser el origen del sitio, sin ruta. Ejemplo: https://brazo-derecho.vercel.app",
    };
  }
  return { tipo: "url", url: url.origin };
}

export function encabezadosDe(response: Response): Encabezados {
  const headers: Encabezados = {};
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    const name = key.toLowerCase();
    headers[name] = [...(headers[name] ?? []), value];
  });
  if (setCookies.length > 0) headers["set-cookie"] = setCookies;
  else {
    const single = response.headers.get("set-cookie");
    if (single) headers["set-cookie"] = [single];
  }
  return headers;
}

export function leerFormularioIngreso(html: string) {
  const action = html.match(/name="(\$ACTION_ID_[0-9a-f]+)"/i);
  if (!action?.[1]) return null;
  const csrf = csrfDelFormulario(html);
  if (!csrf) return null;
  return { actionId: action[1], csrf };
}

function csrfDelFormulario(html: string) {
  const etiquetas = html.match(/<input\b[^>]*>/gi) ?? [];
  for (const etiqueta of etiquetas) {
    if (atributo(etiqueta, "name") !== "csrf") continue;
    const valor = atributo(etiqueta, "value");
    if (valor && /^[a-f0-9]{32}$/i.test(valor)) return valor;
  }
  return null;
}

function atributo(etiqueta: string, nombre: string) {
  const match = etiqueta.match(new RegExp(`\\b${nombre}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  if (!match) return null;
  return match[2] ?? match[3] ?? "";
}

export function clasificarIngreso(
  email: string,
  input: { status: number; location: string | null; haySesion: boolean },
  origen: string,
): Ingreso {
  if (input.haySesion) return { email, resultado: "entro" };
  if (!input.location) {
    return {
      email,
      resultado: "no_concluyente",
      motivo: `el ingreso respondió ${input.status} sin un rechazo de credenciales.`,
    };
  }
  let ubicacion: { pathname: string; error: string | null; externa: boolean };
  try {
    const base = new URL(origen);
    const url = new URL(input.location, base);
    ubicacion = { pathname: url.pathname, error: url.searchParams.get("error"), externa: url.origin !== base.origin };
  } catch {
    return { email, resultado: "no_concluyente", motivo: `el ingreso respondió ${input.status} con una redirección ilegible.` };
  }
  if (ubicacion.externa) {
    return { email, resultado: "no_concluyente", motivo: "el ingreso redirigió fuera del sitio." };
  }
  const error = codigoError(ubicacion.error);
  if (error === "credenciales") return { email, resultado: "rechazada" };
  if (error === "ritmo") {
    return {
      email,
      resultado: "no_concluyente",
      motivo: "el ingreso respondió ritmo (demasiados intentos). No se reintentó.",
    };
  }
  if (error === "csrf") {
    return { email, resultado: "no_concluyente", motivo: "el ingreso respondió csrf y no se pudo comprobar la clave." };
  }
  if (error) {
    return { email, resultado: "no_concluyente", motivo: `el ingreso respondió error ${error}.` };
  }
  if (ubicacion.pathname === "/panel" || ubicacion.pathname.startsWith("/panel/")) {
    return { email, resultado: "entro" };
  }
  return {
    email,
    resultado: "no_concluyente",
    motivo: `el ingreso respondió ${input.status} sin un rechazo de credenciales.`,
  };
}

function codigoError(error: string | null) {
  if (!error || !/^[a-z0-9_]{1,40}$/i.test(error)) return null;
  return error.toLowerCase();
}

export function evaluarSondeo(sondeo: Sondeo): Chequeo[] {
  const https = new URL(sondeo.url).protocol === "https:";
  return [
    evaluarDireccion(https),
    evaluarSalud(sondeo.salud),
    evaluarMercadoPago(sondeo.mercadoPagoSinFirma, sondeo.mercadoPagoTsVencido),
    evaluarFlow(sondeo.flow),
    evaluarWhatsappPost(sondeo.whatsappPost),
    evaluarWhatsappGet(sondeo.whatsappGet),
    evaluarCabeceras(sondeo.cabeceras),
    evaluarCookie(sondeo.ingreso),
    evaluarPanel(sondeo.panel, sondeo.url),
    evaluarTextos(sondeo.terminos, sondeo.privacidad),
    evaluarObservabilidad(sondeo.observabilidad),
    evaluarCuentasDemo(sondeo.cuentas),
  ];
}

function evaluarDireccion(https: boolean): Chequeo {
  if (https) {
    return item("direccion", "Dirección", "pasa", "La URL es https.");
  }
  return item(
    "direccion",
    "Dirección",
    "advertencia",
    "La URL es http. Para cobrar, APP_URL tiene que ser https, sin barra final.",
  );
}

function evaluarSalud(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item("salud", "Salud", "falla", `No se pudo revisar GET /api/health: ${respuesta.error}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(respuesta.body);
  } catch {
    return item("salud", "Salud", "falla", `GET /api/health respondió ${respuesta.status} con un cuerpo que no es JSON.`);
  }
  const record = parsed && typeof parsed === "object" ? (parsed as { ok?: unknown; base?: unknown }) : {};
  if (respuesta.status === 200 && record.ok === true && record.base === "ok") {
    return item("salud", "Salud", "pasa", "GET /api/health respondió 200 con ok verdadero y base ok.");
  }
  if (respuesta.status === 503 && record.base === "error") {
    return item("salud", "Salud", "falla", "GET /api/health respondió 503: la base no contestó.");
  }
  return item(
    "salud",
    "Salud",
    "falla",
    `GET /api/health respondió ${respuesta.status}. Se esperaba 200 con ok verdadero y base ok.`,
  );
}

function evaluarMercadoPago(sinFirma: RespuestaSondeo, tsVencido: RespuestaSondeo): Chequeo {
  if (!sinFirma.ok || !tsVencido.ok) {
    const error = !sinFirma.ok ? sinFirma.error : !tsVencido.ok ? tsVencido.error : "no hubo respuesta";
    return item("mercadopago", "Mercado Pago", "falla", `No se pudo revisar POST /api/mercadopago/webhook: ${error}.`);
  }
  if (sinFirma.status === 401 && tsVencido.status === 401) {
    return item(
      "mercadopago",
      "Mercado Pago",
      "pasa",
      "POST /api/mercadopago/webhook sin firma respondió 401. Con ts vencido también respondió 401.",
    );
  }
  const nota =
    sinFirma.status === 503 || tsVencido.status === 503
      ? " Un 503 indica que el secreto o el access token no están y no se revisó la firma."
      : "";
  return item(
    "mercadopago",
    "Mercado Pago",
    "falla",
    `Sin firma respondió ${sinFirma.status}. Con ts vencido respondió ${tsVencido.status}. Se esperaba 401 en los dos.${nota}`,
  );
}

function evaluarFlow(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item("flow", "Flow", "falla", `No se pudo revisar POST /api/flow/confirmacion: ${respuesta.error}.`);
  }
  if (respuesta.status === 401) {
    return item("flow", "Flow", "pasa", "POST /api/flow/confirmacion con firma inválida respondió 401.");
  }
  const publico = errorPublico(respuesta.body);
  if (respuesta.status === 503 && publico === "Flow no está configurado") {
    return item(
      "flow",
      "Flow",
      "advertencia",
      "POST /api/flow/confirmacion respondió 503: Flow no está configurado. Hoy el cobro es con Mercado Pago, así que esto no es una falla crítica. Cuando cobres con Flow, este aviso tiene que responder 401.",
    );
  }
  const extra = publico ? ` ${publico}.` : "";
  if (respuesta.status === 503) {
    return item(
      "flow",
      "Flow",
      "falla",
      `POST /api/flow/confirmacion con firma inválida respondió 503.${extra} Se esperaba 401.`,
    );
  }
  return item(
    "flow",
    "Flow",
    "falla",
    `POST /api/flow/confirmacion con firma inválida respondió ${respuesta.status}. Se esperaba 401.`,
  );
}

function evaluarWhatsappPost(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item("whatsapp", "WhatsApp", "falla", `No se pudo revisar POST /api/whatsapp: ${respuesta.error}.`);
  }
  if (respuesta.status === 401) {
    return item(
      "whatsapp",
      "WhatsApp",
      "pasa",
      "POST /api/whatsapp sin X-Hub-Signature-256 válida respondió 401. La firma no calza y el aviso se rechaza.",
    );
  }
  if (respuesta.status === 503) {
    const publico = errorPublico(respuesta.body);
    const porque = publico ? ` (${publico})` : "";
    return item(
      "whatsapp",
      "WhatsApp",
      "pasa",
      `POST /api/whatsapp sin X-Hub-Signature-256 válida respondió 503${porque}. Sin el secreto de la app el aviso no se procesa.`,
    );
  }
  return item(
    "whatsapp",
    "WhatsApp",
    "falla",
    `POST /api/whatsapp sin firma válida respondió ${respuesta.status}. Se esperaba 401 o 503.`,
  );
}

function evaluarWhatsappGet(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item(
      "whatsapp-verificacion",
      "Verificación de Meta",
      "advertencia",
      `No se pudo revisar GET /api/whatsapp: ${respuesta.error}.`,
    );
  }
  if (respuesta.status === 403) {
    return item(
      "whatsapp-verificacion",
      "Verificación de Meta",
      "pasa",
      "GET /api/whatsapp con un verify token inventado respondió 403. El token está configurado y rechaza uno que no calza.",
    );
  }
  if (respuesta.status === 503) {
    return item(
      "whatsapp-verificacion",
      "Verificación de Meta",
      "advertencia",
      "GET /api/whatsapp respondió 503. Sin WHATSAPP_VERIFY_TOKEN, Meta no puede verificar el webhook.",
    );
  }
  if (respuesta.status === 200) {
    return item(
      "whatsapp-verificacion",
      "Verificación de Meta",
      "falla",
      "GET /api/whatsapp respondió 200 con un verify token inventado. No debería aceptar el desafío.",
    );
  }
  return item(
    "whatsapp-verificacion",
    "Verificación de Meta",
    "falla",
    `GET /api/whatsapp respondió ${respuesta.status}. Se esperaba 403 si el token está configurado, o 503 si falta.`,
  );
}

function evaluarCabeceras(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item("cabeceras", "Cabeceras", "falla", `No se pudieron leer las cabeceras: ${respuesta.error}.`);
  }
  const problemas = problemasCabeceras(respuesta.headers);
  if (problemas.length === 0) {
    return item(
      "cabeceras",
      "Cabeceras",
      "pasa",
      "CSP sin unsafe-eval, con frame-ancestors 'none'. HSTS presente. X-Frame-Options DENY. nosniff y sin X-Powered-By.",
    );
  }
  return item("cabeceras", "Cabeceras", "falla", problemas.join("\n"));
}

function problemasCabeceras(headers: Encabezados) {
  const problemas: string[] = [];
  const csp = valorEncabezado(headers, "content-security-policy", "; ");
  const reportOnly = valorEncabezado(headers, "content-security-policy-report-only", "; ");
  if (!csp) {
    problemas.push(
      reportOnly
        ? "Falta Content-Security-Policy que se aplique. Solo llegó Content-Security-Policy-Report-Only."
        : "Falta Content-Security-Policy.",
    );
  } else {
    const directivas = partirDirectivas(csp);
    if (directivas.some((tokens) => tokens.slice(1).some((token) => tokenLimpio(token) === "unsafe-eval"))) {
      problemas.push("La CSP incluye unsafe-eval. En producción no va.");
    }
    const script = directivas.find((tokens) => tokens[0]?.toLowerCase() === "script-src");
    if (!script) problemas.push("La CSP no trae script-src.");
    else if (!script.slice(1).some((token) => tokenLimpio(token) === "self")) {
      problemas.push("script-src no incluye 'self'.");
    }
    const exigidas: { nombre: string; token: string; texto: string }[] = [
      { nombre: "default-src", token: "self", texto: "La CSP no trae default-src 'self'." },
      { nombre: "frame-ancestors", token: "none", texto: "La CSP no trae frame-ancestors 'none'." },
      { nombre: "base-uri", token: "self", texto: "La CSP no trae base-uri 'self'." },
      { nombre: "form-action", token: "self", texto: "La CSP no trae form-action 'self'." },
      { nombre: "object-src", token: "none", texto: "La CSP no trae object-src 'none'." },
    ];
    for (const exigida of exigidas) {
      const encontrada = directivas.find((tokens) => tokens[0]?.toLowerCase() === exigida.nombre);
      if (!encontrada || !encontrada.slice(1).some((token) => tokenLimpio(token) === exigida.token)) {
        problemas.push(exigida.texto);
      }
    }
  }

  const hsts = valorEncabezado(headers, "strict-transport-security").toLowerCase();
  if (!hsts) problemas.push("Falta Strict-Transport-Security.");
  else {
    const maxAge = hsts.match(/max-age=(\d+)/);
    if (!maxAge || Number(maxAge[1]) <= 0) problemas.push("HSTS no trae un max-age mayor que cero.");
  }

  const frame = valorEncabezado(headers, "x-frame-options").trim();
  if (!frame) problemas.push("Falta X-Frame-Options: DENY.");
  else if (frame.toUpperCase() !== "DENY") problemas.push(`X-Frame-Options es ${frame.slice(0, 40)}. Se esperaba DENY.`);

  if (valorEncabezado(headers, "x-content-type-options").trim().toLowerCase() !== "nosniff") {
    problemas.push("Falta X-Content-Type-Options: nosniff.");
  }

  const referrer = valorEncabezado(headers, "referrer-policy").trim().toLowerCase();
  const referrerSeguro = ["same-origin", "no-referrer", "strict-origin", "strict-origin-when-cross-origin"];
  if (!referrer) problemas.push("Falta Referrer-Policy.");
  else if (!referrerSeguro.includes(referrer)) problemas.push(`Referrer-Policy es ${referrer.slice(0, 60)}.`);

  const permisos = valorEncabezado(headers, "permissions-policy").replace(/\s+/g, "").toLowerCase();
  if (!permisos) problemas.push("Falta Permissions-Policy.");
  else {
    for (const permiso of ["camera=()", "geolocation=()", "payment=()"]) {
      if (!permisos.includes(permiso)) problemas.push(`Permissions-Policy no trae ${permiso}.`);
    }
    if (!permisos.includes("microphone=(self)")) {
      problemas.push("Permissions-Policy no permite el micrófono solo en este sitio (microphone=(self)).");
    }
  }

  const coop = valorEncabezado(headers, "cross-origin-opener-policy").trim().toLowerCase();
  if (coop !== "same-origin" && coop !== "same-origin-allow-popups") {
    problemas.push(coop ? `Cross-Origin-Opener-Policy es ${coop.slice(0, 60)}.` : "Falta Cross-Origin-Opener-Policy.");
  }

  if (valorEncabezado(headers, "x-dns-prefetch-control").trim().toLowerCase() !== "off") {
    problemas.push("Falta X-DNS-Prefetch-Control: off.");
  }

  if (valorEncabezado(headers, "x-powered-by")) problemas.push("Aparece X-Powered-By. En producción no va.");
  return problemas;
}

function partirDirectivas(csp: string) {
  return csp
    .split(";")
    .map((parte) => parte.trim().split(/\s+/).filter(Boolean))
    .filter((tokens) => tokens.length > 0);
}

function tokenLimpio(token: string) {
  return token.replace(/^'+|'+$/g, "").toLowerCase();
}

function evaluarCookie(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item("cookie", "Cookie", "falla", `No se pudo revisar la cookie de /ingresar: ${respuesta.error}.`);
  }
  const linea = lineasSetCookie(respuesta.headers).find((itemCookie) => /^bd_csrf=/i.test(itemCookie.trim()));
  if (!linea) return item("cookie", "Cookie", "falla", "GET /ingresar no dejó la cookie bd_csrf.");
  const atributos = linea
    .split(";")
    .slice(1)
    .map((atributoCookie) => atributoCookie.trim().toLowerCase());
  const problemas: string[] = [];
  if (!atributos.includes("httponly")) problemas.push("bd_csrf no trae HttpOnly.");
  if (!atributos.includes("secure")) problemas.push("bd_csrf no trae Secure.");
  const sameSite = atributos.find((atributoCookie) => atributoCookie.startsWith("samesite="))?.split("=")[1] ?? "";
  if (sameSite !== "lax" && sameSite !== "strict") problemas.push("bd_csrf no trae SameSite=lax ni SameSite=strict.");
  if (problemas.length === 0) {
    return item("cookie", "Cookie", "pasa", `bd_csrf sale HttpOnly, Secure y SameSite=${sameSite}.`);
  }
  return item("cookie", "Cookie", "falla", problemas.join("\n"));
}

function evaluarPanel(respuesta: RespuestaSondeo, origen: string): Chequeo {
  if (!respuesta.ok) {
    return item("panel", "Panel", "falla", `No se pudo revisar /panel sin sesión: ${respuesta.error}.`);
  }
  const redirige = [301, 302, 303, 307, 308].includes(respuesta.status);
  if (redirige && respuesta.location && redirigeAIngreso(respuesta.location, origen)) {
    return item("panel", "Panel", "pasa", "Sin sesión, /panel redirige a /ingresar.");
  }
  if (respuesta.location && esExterna(respuesta.location, origen)) {
    return item("panel", "Panel", "falla", "Sin sesión, /panel redirige fuera del sitio.");
  }
  if (respuesta.status === 200) {
    return item("panel", "Panel", "falla", "Sin sesión, /panel respondió 200. Tendría que redirigir a /ingresar.");
  }
  return item("panel", "Panel", "falla", `Sin sesión, /panel respondió ${respuesta.status}. Tendría que redirigir a /ingresar.`);
}

function redirigeAIngreso(location: string, origen: string) {
  try {
    const url = new URL(location, origen);
    if (url.origin !== new URL(origen).origin) return false;
    return url.pathname === "/ingresar" || url.pathname.startsWith("/ingresar/");
  } catch {
    return false;
  }
}

function esExterna(location: string, origen: string) {
  try {
    return new URL(location, origen).origin !== new URL(origen).origin;
  } catch {
    return false;
  }
}

function evaluarTextos(terminos: RespuestaSondeo, privacidad: RespuestaSondeo): Chequeo {
  const paginas = [
    { nombre: "términos", respuesta: terminos },
    { nombre: "privacidad", respuesta: privacidad },
  ];
  const problemas: string[] = [];
  const borradores: string[] = [];
  for (const pagina of paginas) {
    if (!pagina.respuesta.ok) {
      problemas.push(`No se pudo abrir ${pagina.nombre}: ${pagina.respuesta.error}.`);
      continue;
    }
    if (pagina.respuesta.status !== 200) {
      problemas.push(`${pagina.nombre} respondió ${pagina.respuesta.status}.`);
      continue;
    }
    if (/borrador/i.test(pagina.respuesta.body)) borradores.push(pagina.nombre);
  }
  if (borradores.length > 0) {
    const frase =
      borradores.length >= 2
        ? "Términos y privacidad siguen en borrador."
        : borradores[0] === "términos"
          ? "Los términos siguen en borrador."
          : "La privacidad sigue en borrador.";
    const extra = problemas.length > 0 ? `\n${problemas.join("\n")}` : "";
    return item(
      "textos-legales",
      "Textos legales",
      "advertencia",
      `${frase} Antes del primer cobro hace falta la revisión legal (Ley 21.719).${extra}`,
    );
  }
  if (problemas.length > 0) {
    return item("textos-legales", "Textos legales", "advertencia", problemas.join("\n"));
  }
  return item(
    "textos-legales",
    "Textos legales",
    "pasa",
    "Términos y privacidad ya no traen la marca de borrador. La revisión legal sigue siendo de una persona.",
  );
}

function evaluarObservabilidad(respuesta: RespuestaSondeo): Chequeo {
  if (!respuesta.ok) {
    return item(
      "observabilidad",
      "Observabilidad",
      "advertencia",
      `No se pudo revisar POST /api/observabilidad: ${respuesta.error}.`,
    );
  }
  if (respuesta.status === 400) {
    return item("observabilidad", "Observabilidad", "pasa", "Un cuerpo inválido en POST /api/observabilidad responde 400.");
  }
  if (respuesta.status >= 200 && respuesta.status < 300) {
    return item(
      "observabilidad",
      "Observabilidad",
      "falla",
      `Un cuerpo inválido en POST /api/observabilidad respondió ${respuesta.status}. Tendría que rechazarlo.`,
    );
  }
  if (respuesta.status === 429) {
    return item(
      "observabilidad",
      "Observabilidad",
      "advertencia",
      "POST /api/observabilidad respondió 429. Espera un minuto y vuelve a correr el chequeo.",
    );
  }
  return item(
    "observabilidad",
    "Observabilidad",
    "advertencia",
    `POST /api/observabilidad respondió ${respuesta.status}. Se esperaba 400 para un cuerpo inválido.`,
  );
}

export function evaluarCuentasDemo(ingresos: Ingreso[]): Chequeo {
  const porEmail = new Map(ingresos.map((ingreso) => [ingreso.email, ingreso]));
  const entraron = DEMO_ACCOUNTS.filter((email) => porEmail.get(email)?.resultado === "entro");
  const rechazadas = DEMO_ACCOUNTS.filter((email) => porEmail.get(email)?.resultado === "rechazada");
  const otras = DEMO_ACCOUNTS.filter((email) => !entraron.includes(email) && !rechazadas.includes(email));

  if (entraron.length === 0 && otras.length === 0) {
    return item(
      "cuentas-demo",
      "Cuentas demo",
      "pasa",
      `${lista(rechazadas)} no entran con la clave del seed.`,
    );
  }

  if (entraron.length > 0) {
    const verbo = entraron.length === 1 ? "entró" : "entraron";
    const cargada = entraron.length === 1 ? "La cuenta está cargada" : "Las cuentas están cargadas";
    const cambiala = entraron.length === 1 ? "cámbiala o sácala" : "cámbialas o sácalas";
    const lineas = [
      `${lista(entraron)} ${verbo} con la clave del seed.`,
      `${cargada} a propósito para la demo. Antes de abrir el cobro, ${cambiala}. El chequeo no usó la sesión.`,
    ];
    if (rechazadas.length > 0) lineas.push(`${lista(rechazadas)} no entra con esa clave.`);
    for (const email of otras) lineas.push(`${email}: ${motivoDe(porEmail.get(email))}`);
    return item("cuentas-demo", "Cuentas demo", "advertencia", lineas.join("\n"));
  }

  const lineas: string[] = [];
  if (rechazadas.length > 0) lineas.push(`${lista(rechazadas)} no entra con la clave del seed.`);
  for (const email of otras) lineas.push(`${email}: ${motivoDe(porEmail.get(email))}`);
  return item("cuentas-demo", "Cuentas demo", "advertencia", lineas.join("\n"));
}

function motivoDe(ingreso: Ingreso | undefined) {
  if (ingreso?.resultado === "no_concluyente") return ingreso.motivo;
  return "no se comprobó.";
}

function lista(emails: readonly string[]) {
  if (emails.length <= 1) return emails[0] ?? "";
  return `${emails.slice(0, -1).join(", ")} y ${emails[emails.length - 1]}`;
}

function item(id: string, titulo: string, nivel: Nivel, detalle: string): Chequeo {
  return { id, titulo, nivel, detalle };
}

function lineasSetCookie(headers: Encabezados) {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === "set-cookie")?.[1] ?? [];
}

function valorEncabezado(headers: Encabezados, nombre: string, separador = ", ") {
  const clave = nombre.toLowerCase();
  const valores = Object.entries(headers).find(([key]) => key.toLowerCase() === clave)?.[1] ?? [];
  return valores
    .map((valor) => valor.trim())
    .filter(Boolean)
    .join(separador);
}

const ERRORES_PUBLICOS = new Set(["Flow no está configurado", "Falta WHATSAPP_APP_SECRET"]);

function errorPublico(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error !== "string" || !ERRORES_PUBLICOS.has(parsed.error)) return null;
    return parsed.error;
  } catch {
    return null;
  }
}

export function codigoSalida(chequeos: Chequeo[]): 0 | 1 {
  return chequeos.some((chequeo) => chequeo.nivel === "falla") ? 1 : 0;
}

export function formatearInforme(url: string, chequeos: Chequeo[]) {
  const lineas = [`Chequeo de solo lectura · ${url}`, ""];
  for (const chequeo of chequeos) {
    const etiqueta = { pasa: "PASA", falla: "FALLA", advertencia: "ADVERTENCIA" }[chequeo.nivel].padEnd(12, " ");
    lineas.push(`${etiqueta}${chequeo.titulo}`);
    for (const parte of chequeo.detalle.split("\n")) lineas.push(`${" ".repeat(12)}${parte}`);
    lineas.push("");
  }
  lineas.push(resumenChequeos(chequeos));
  return lineas.join("\n");
}

export function resumenChequeos(chequeos: Chequeo[]) {
  const pasan = chequeos.filter((chequeo) => chequeo.nivel === "pasa").length;
  const fallan = chequeos.filter((chequeo) => chequeo.nivel === "falla").length;
  const advertencias = chequeos.filter((chequeo) => chequeo.nivel === "advertencia").length;
  const total = chequeos.length === 1 ? "1 chequeo" : `${chequeos.length} chequeos`;
  const pasaTexto = pasan === 1 ? "1 pasa" : `${pasan} pasan`;
  const fallaTexto = fallan === 1 ? "1 falla crítica" : `${fallan} fallas críticas`;
  const advTexto = advertencias === 1 ? "1 advertencia" : `${advertencias} advertencias`;
  return `${total}: ${pasaTexto}, ${fallaTexto}, ${advTexto}.`;
}

export async function verificarProduccion(url: string, fetchImpl: FetchLike = fetchReal, esperaMs = ESPERA_MS) {
  const cli = resolverCli(["--url", url], undefined);
  if (cli.tipo !== "url") {
    const detalle = cli.tipo === "error" ? cli.mensaje : "Falta la URL.";
    return [item("direccion", "Dirección", "falla", detalle)];
  }
  const origen = cli.url;
  const [salud, mercadoPagoSinFirma, mercadoPagoTsVencido, flow, whatsappPost, whatsappGet, ingreso, panel, terminos, privacidad, observabilidad] =
    await Promise.all([
      pedir(fetchImpl, `${origen}/api/health`, { method: "GET" }, esperaMs),
      pedir(fetchImpl, `${origen}/api/mercadopago/webhook?data.id=${ID_SONDEO}`, pedidoJson("{}"), esperaMs),
      pedir(
        fetchImpl,
        `${origen}/api/mercadopago/webhook?data.id=${ID_SONDEO}`,
        pedidoJson("{}", {
          "x-request-id": ID_SONDEO,
          "x-signature": `ts=${TS_VENCIDO},v1=${FIRMA_FALSA}`,
        }),
        esperaMs,
      ),
      pedir(
        fetchImpl,
        `${origen}/api/flow/confirmacion`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `token=${ID_SONDEO}&s=firma-invalida`,
        },
        esperaMs,
      ),
      pedir(
        fetchImpl,
        `${origen}/api/whatsapp`,
        pedidoJson("{}", { "x-hub-signature-256": `sha256=${FIRMA_FALSA}` }),
        esperaMs,
      ),
      pedir(
        fetchImpl,
        `${origen}/api/whatsapp?hub.mode=subscribe&hub.verify_token=${ID_SONDEO}&hub.challenge=no-revelar`,
        { method: "GET" },
        esperaMs,
      ),
      pedir(fetchImpl, `${origen}/ingresar`, { method: "GET" }, esperaMs),
      pedir(fetchImpl, `${origen}/panel`, { method: "GET" }, esperaMs),
      pedir(fetchImpl, `${origen}/terminos`, { method: "GET" }, esperaMs),
      pedir(fetchImpl, `${origen}/privacidad`, { method: "GET" }, esperaMs),
      pedir(
        fetchImpl,
        `${origen}/api/observabilidad`,
        pedidoJson('{"source":"otro","name":"Error","message":"x"}'),
        esperaMs,
      ),
    ]);

  const cuentas = await sondearCuentas(fetchImpl, origen, ingreso, esperaMs);
  const cabeceras = salud.ok ? salud : ingreso;
  return evaluarSondeo({
    url: origen,
    salud,
    mercadoPagoSinFirma,
    mercadoPagoTsVencido,
    flow,
    whatsappPost,
    whatsappGet,
    cabeceras,
    ingreso,
    panel,
    terminos,
    privacidad,
    observabilidad,
    cuentas,
  });
}

function pedidoJson(body: string, extra: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...extra }, body };
}

async function sondearCuentas(fetchImpl: FetchLike, origen: string, ingreso: RespuestaSondeo, esperaMs: number) {
  const inconcluso = (email: string, motivo: string): Ingreso => ({ email, resultado: "no_concluyente", motivo });
  if (!ingreso.ok) return DEMO_ACCOUNTS.map((email) => inconcluso(email, "no se pudo abrir /ingresar."));
  const formulario = leerFormularioIngreso(ingreso.body);
  const cookie = valorCookie(ingreso.headers["set-cookie"] ?? [], "bd_csrf");
  if (!formulario || !cookie) {
    return DEMO_ACCOUNTS.map((email) => inconcluso(email, "el formulario de ingreso no trae el token de seguridad."));
  }
  if (formulario.csrf !== cookie || !/^[a-f0-9]{32}$/i.test(cookie)) {
    return DEMO_ACCOUNTS.map((email) => inconcluso(email, "la cookie y el formulario de ingreso no coinciden."));
  }

  const resultados: Ingreso[] = [];
  let token = cookie;
  for (let index = 0; index < DEMO_ACCOUNTS.length; index += 1) {
    const email = DEMO_ACCOUNTS[index] ?? "";
    const form = new FormData();
    form.set(formulario.actionId, "");
    form.set("csrf", token);
    form.set("siguiente", "/panel");
    form.set("email", email);
    form.set("password", DEMO_PASSWORD);
    const respuesta = await pedir(
      fetchImpl,
      `${origen}/ingresar`,
      {
        method: "POST",
        headers: { origin: origen, cookie: `bd_csrf=${token}` },
        body: form,
      },
      esperaMs,
    );
    if (!respuesta.ok) {
      resultados.push(inconcluso(email, "no hubo respuesta al intentar ingresar."));
      continue;
    }
    const clasificado = clasificarIngreso(
      email,
      {
        status: respuesta.status,
        location: respuesta.location,
        haySesion: (respuesta.headers["set-cookie"] ?? []).some((linea) => /^bd_session=/i.test(linea.trim())),
      },
      origen,
    );
    resultados.push(clasificado);
    if (clasificado.resultado === "no_concluyente" && clasificado.motivo.includes("ritmo")) {
      for (const pendiente of DEMO_ACCOUNTS.slice(index + 1)) {
        resultados.push(inconcluso(pendiente, "no se intentó para no sumar intentos: el ingreso ya respondió ritmo."));
      }
      break;
    }
    const nuevo = valorCookie(respuesta.headers["set-cookie"] ?? [], "bd_csrf");
    if (nuevo && /^[a-f0-9]{32}$/i.test(nuevo)) token = nuevo;
  }
  return resultados;
}

function valorCookie(lineas: string[], nombre: string) {
  const prefijo = `${nombre.toLowerCase()}=`;
  const linea = lineas.find((itemCookie) => itemCookie.trim().toLowerCase().startsWith(prefijo));
  if (!linea) return null;
  const primero = linea.split(";")[0]?.trim() ?? "";
  const valor = primero.slice(primero.indexOf("=") + 1).trim();
  return valor || null;
}

async function pedir(fetchImpl: FetchLike, url: string, init: RequestInit, esperaMs: number): Promise<RespuestaSondeo> {
  const espera = controlDeEspera(esperaMs);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    headers.set("cache-control", "no-store");
    const response = await fetchImpl(url, { ...init, headers, redirect: "manual", signal: espera.signal });
    const body = (await response.text()).slice(0, CUERPO_MAX);
    return { ok: true, status: response.status, body, headers: encabezadosDe(response), location: response.headers.get("location") };
  } catch {
    return { ok: false, error: espera.signal.aborted ? "la espera se agotó" : "no hubo respuesta" };
  } finally {
    espera.cancelar();
  }
}

function controlDeEspera(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    cancelar() {
      clearTimeout(timer);
    },
  };
}
