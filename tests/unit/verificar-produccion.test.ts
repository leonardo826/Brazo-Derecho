import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  clasificarIngreso,
  codigoSalida,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  encabezadosDe,
  evaluarCuentasDemo,
  evaluarSondeo,
  formatearInforme,
  leerAppUrl,
  leerFormularioIngreso,
  resolverCli,
  verificarProduccion,
  type Chequeo,
  type Encabezados,
  type FetchLike,
  type Ingreso,
  type RespuestaSondeo,
  type Sondeo,
} from "@/lib/verificar-produccion";

const ORIGEN = "https://ejemplo.cl";
const CSRF = "324335d0d12aa5521da89fa746738c56";
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const COOKIE = `bd_csrf=${CSRF}; Path=/; Expires=Mon, 09 Nov 2026 12:11:27 GMT; Max-Age=604800; Secure; HttpOnly; SameSite=lax`;

function ok(status: number, body = "", headers: Encabezados = {}, location: string | null = null): RespuestaSondeo {
  return { ok: true, status, body, headers, location };
}

function cabecerasOk(extra: Encabezados = {}): Encabezados {
  return {
    "content-security-policy": [CSP],
    "strict-transport-security": ["max-age=63072000; includeSubDomains"],
    "x-frame-options": ["DENY"],
    "x-content-type-options": ["nosniff"],
    "referrer-policy": ["same-origin"],
    "permissions-policy": ["camera=(), microphone=(self), geolocation=(), payment=()"],
    "cross-origin-opener-policy": ["same-origin-allow-popups"],
    "x-dns-prefetch-control": ["off"],
    ...extra,
  };
}

function htmlIngreso(csrf = CSRF) {
  return `<form action="" method="POST"><input type="hidden" name="$ACTION_ID_40020a9aec2516ea9d98b6bcac0ebe29668362869b"/><input type="hidden" name="csrf" value="${csrf}"/></form>`;
}

function rechazada(email: string): Ingreso {
  return { email, resultado: "rechazada" };
}

function sondeoListo(parcial: Partial<Sondeo> = {}): Sondeo {
  return {
    url: ORIGEN,
    salud: ok(200, JSON.stringify({ ok: true, servicio: "brazo-derecho", base: "ok" })),
    mercadoPagoSinFirma: ok(401, JSON.stringify({ ok: false })),
    mercadoPagoTsVencido: ok(401, JSON.stringify({ ok: false })),
    flow: ok(401, JSON.stringify({ ok: false })),
    whatsappPost: ok(401, JSON.stringify({ ok: false })),
    whatsappGet: ok(403),
    cabeceras: ok(200, "", cabecerasOk()),
    ingreso: ok(200, htmlIngreso(), { "set-cookie": [COOKIE] }),
    panel: ok(307, "", {}, "/ingresar?siguiente=%2Fpanel"),
    terminos: ok(200, "<p>Texto revisado</p>"),
    privacidad: ok(200, "<p>Texto revisado</p>"),
    observabilidad: ok(400, JSON.stringify({ ok: false })),
    cuentas: DEMO_ACCOUNTS.map((email) => rechazada(email)),
    ...parcial,
  };
}

function porId(chequeos: Chequeo[], id: string) {
  const chequeo = chequeos.find((item) => item.id === id);
  expect(chequeo, id).toBeDefined();
  return chequeo as Chequeo;
}

describe("argumentos", () => {
  test("usa la URL explícita y, si falta, APP_URL", () => {
    expect(resolverCli(["--url", "https://ejemplo.cl/"], undefined)).toEqual({ tipo: "url", url: ORIGEN });
    expect(resolverCli(["--url=https://ejemplo.cl"], "https://otra.cl")).toEqual({ tipo: "url", url: ORIGEN });
    expect(resolverCli([], "https://ejemplo.cl")).toEqual({ tipo: "url", url: ORIGEN });
    expect(resolverCli(["--ayuda"], undefined).tipo).toBe("ayuda");
  });

  test("rechaza una URL con clave, con ruta o vacía, sin repetir el secreto", () => {
    const conClave = resolverCli(["--url", "https://user:supersecreto@ejemplo.cl"], undefined);
    expect(conClave.tipo).toBe("error");
    expect(JSON.stringify(conClave)).not.toContain("supersecreto");
    expect(resolverCli(["--url", "https://ejemplo.cl/panel"], undefined).tipo).toBe("error");
    expect(resolverCli(["ftp://ejemplo.cl"], undefined).tipo).toBe("error");
    expect(resolverCli([], "  ").tipo).toBe("error");
    expect(resolverCli(["--raro"], undefined).tipo).toBe("error");
  });

  test("lee solo APP_URL desde un env con otras claves", () => {
    const texto = ['SESSION_SECRET="super-secreto"', 'APP_URL="https://ejemplo.cl"', "XAI_API_KEY=clave-xai"].join("\n");
    expect(leerAppUrl(texto)).toBe(ORIGEN);
    expect(leerAppUrl("APP_URL=")).toBeUndefined();
    expect(leerAppUrl("# APP_URL=https://comentario.cl\nexport APP_URL=https://ejemplo.cl")).toBe(ORIGEN);
  });
});

describe("formulario de ingreso", () => {
  test("lee la acción y el csrf aunque el valor venga antes del nombre", () => {
    expect(leerFormularioIngreso(htmlIngreso())).toEqual({
      actionId: "$ACTION_ID_40020a9aec2516ea9d98b6bcac0ebe29668362869b",
      csrf: CSRF,
    });
    const alReves = `<input value="${CSRF}" name="csrf" type="hidden"><input name="$ACTION_ID_aaaaaaaa" />`;
    expect(leerFormularioIngreso(alReves)?.csrf).toBe(CSRF);
    expect(leerFormularioIngreso("<form></form>")).toBeNull();
  });

  test("separa la cookie de sesión para no mezclarla con la de csrf", () => {
    const headers = new Headers();
    headers.append("set-cookie", COOKIE);
    headers.append("set-cookie", "bd_session=SESION-NO-DEBE-SALIR; HttpOnly; Secure; SameSite=lax");
    const leidas = encabezadosDe(new Response(null, { status: 200, headers }));
    expect(leidas["set-cookie"]).toHaveLength(2);
    expect(leidas["set-cookie"]?.[1]).toContain("SESION-NO-DEBE-SALIR");
  });
});

describe("clasificación del ingreso", () => {
  test("credenciales rechazadas, sesión abierta y casos que no cierran", () => {
    expect(clasificarIngreso("maria@losaromos.cl", { status: 303, location: "/ingresar?error=credenciales", haySesion: false }, ORIGEN)).toEqual({
      email: "maria@losaromos.cl",
      resultado: "rechazada",
    });
    expect(
      clasificarIngreso(
        "maria@losaromos.cl",
        { status: 303, location: `${ORIGEN}/ingresar?error=credenciales`, haySesion: false },
        ORIGEN,
      ).resultado,
    ).toBe("rechazada");
    expect(clasificarIngreso("maria@losaromos.cl", { status: 303, location: "/panel", haySesion: false }, ORIGEN).resultado).toBe("entro");
    expect(
      clasificarIngreso("maria@losaromos.cl", { status: 303, location: "/ingresar?error=credenciales", haySesion: true }, ORIGEN).resultado,
    ).toBe("entro");
    expect(clasificarIngreso("maria@losaromos.cl", { status: 303, location: "/ingresar?error=ritmo", haySesion: false }, ORIGEN).resultado).toBe(
      "no_concluyente",
    );
    const externo = clasificarIngreso("maria@losaromos.cl", { status: 303, location: "https://evil.test/panel", haySesion: false }, ORIGEN);
    expect(externo.resultado).toBe("no_concluyente");
    if (externo.resultado === "no_concluyente") expect(externo.motivo).toContain("fuera del sitio");
    const raro = clasificarIngreso("maria@losaromos.cl", { status: 303, location: "/ingresar?error=token%20secreto", haySesion: false }, ORIGEN);
    expect(raro.resultado).toBe("no_concluyente");
    expect(JSON.stringify(raro)).not.toContain("secreto");
  });
});

describe("evaluación", () => {
  test("un sitio listo no tiene fallas críticas", () => {
    const chequeos = evaluarSondeo(sondeoListo());
    expect(codigoSalida(chequeos)).toBe(0);
    expect(chequeos.every((chequeo) => chequeo.nivel === "pasa")).toBe(true);
    expect(formatearInforme(ORIGEN, chequeos)).toContain("PASA");
    expect(formatearInforme(ORIGEN, chequeos)).not.toContain(DEMO_PASSWORD);
  });

  test("salud exige 200, ok verdadero y base ok", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "salud").nivel).toBe("pasa");
    expect(porId(evaluarSondeo(sondeoListo({ salud: ok(503, JSON.stringify({ ok: false, base: "error" })) })), "salud").detalle).toContain("503");
    expect(porId(evaluarSondeo(sondeoListo({ salud: ok(200, JSON.stringify({ ok: "true", base: "ok" })) })), "salud").nivel).toBe("falla");
    expect(porId(evaluarSondeo(sondeoListo({ salud: ok(200, "{") })), "salud").detalle).toContain("no es JSON");
    expect(porId(evaluarSondeo(sondeoListo({ salud: { ok: false, error: "no hubo respuesta" } })), "salud").detalle).toContain("no hubo respuesta");
  });

  test("Mercado Pago exige 401 sin firma y con ts vencido", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "mercadopago").nivel).toBe("pasa");
    const incompleto = evaluarSondeo(sondeoListo({ mercadoPagoTsVencido: ok(503, JSON.stringify({ ok: false })) }));
    expect(porId(incompleto, "mercadopago").nivel).toBe("falla");
    expect(porId(incompleto, "mercadopago").detalle).toContain("503");
    expect(porId(evaluarSondeo(sondeoListo({ mercadoPagoSinFirma: ok(200, "{}") })), "mercadopago").nivel).toBe("falla");
  });

  test("Flow sin configurar es advertencia y una firma inválida exige 401", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "flow").nivel).toBe("pasa");
    const sinClaves = evaluarSondeo(
      sondeoListo({ flow: ok(503, JSON.stringify({ ok: false, error: "Flow no está configurado" })) }),
    );
    expect(porId(sinClaves, "flow").nivel).toBe("advertencia");
    expect(porId(sinClaves, "flow").detalle).toContain("Flow no está configurado");
    expect(porId(sinClaves, "flow").detalle).toContain("Mercado Pago");
    expect(codigoSalida(sinClaves)).toBe(0);
    expect(porId(evaluarSondeo(sondeoListo({ flow: ok(200, JSON.stringify({ ok: true })) })), "flow").nivel).toBe("falla");
    const raro = evaluarSondeo(sondeoListo({ flow: ok(503, JSON.stringify({ error: "token secreto de flow" })) }));
    expect(porId(raro, "flow").nivel).toBe("falla");
    expect(porId(raro, "flow").detalle).not.toContain("token secreto");
  });

  test("WhatsApp informa 401 o 503 y falla con otro código", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "whatsapp").detalle).toContain("401");
    const sinSecreto = evaluarSondeo(
      sondeoListo({ whatsappPost: ok(503, JSON.stringify({ ok: false, error: "Falta WHATSAPP_APP_SECRET" })) }),
    );
    expect(porId(sinSecreto, "whatsapp").nivel).toBe("pasa");
    expect(porId(sinSecreto, "whatsapp").detalle).toContain("503");
    expect(porId(sinSecreto, "whatsapp").detalle).toContain("Falta WHATSAPP_APP_SECRET");
    expect(porId(evaluarSondeo(sondeoListo({ whatsappPost: ok(200, "{}") })), "whatsapp").nivel).toBe("falla");
  });

  test("el desafío de Meta distingue 403, 503 y un 200", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "whatsapp-verificacion").nivel).toBe("pasa");
    expect(porId(evaluarSondeo(sondeoListo({ whatsappGet: ok(503) })), "whatsapp-verificacion").nivel).toBe("advertencia");
    expect(porId(evaluarSondeo(sondeoListo({ whatsappGet: ok(200, "no-revelar") })), "whatsapp-verificacion").nivel).toBe("falla");
  });

  test("las cabeceras de producción rechazan unsafe-eval, HSTS ausente y X-Powered-By", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "cabeceras").nivel).toBe("pasa");
    const conEval = cabecerasOk({ "content-security-policy": [CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")] });
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", conEval) })), "cabeceras").detalle).toContain("unsafe-eval");
    const wasm = cabecerasOk({
      "content-security-policy": [CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'")],
    });
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", wasm) })), "cabeceras").nivel).toBe("pasa");
    const sinHsts = cabecerasOk();
    delete sinHsts["strict-transport-security"];
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", sinHsts) })), "cabeceras").detalle).toContain("Strict-Transport-Security");
    const powered = cabecerasOk({ "x-powered-by": ["Next.js"] });
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", powered) })), "cabeceras").detalle).toContain("X-Powered-By");
    const sameOrigin = cabecerasOk({ "x-frame-options": ["SAMEORIGIN"] });
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", sameOrigin) })), "cabeceras").detalle).toContain("DENY");
    const soloReporte = cabecerasOk();
    delete soloReporte["content-security-policy"];
    soloReporte["content-security-policy-report-only"] = [CSP];
    expect(porId(evaluarSondeo(sondeoListo({ cabeceras: ok(200, "", soloReporte) })), "cabeceras").detalle).toContain("Report-Only");
  });

  test("la cookie bd_csrf exige HttpOnly, Secure y SameSite", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "cookie").detalle).toContain("SameSite=lax");
    const insegura = "bd_csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; Path=/; SameSite=none";
    const chequeo = porId(evaluarSondeo(sondeoListo({ ingreso: ok(200, htmlIngreso(), { "Set-Cookie": [insegura] }) })), "cookie");
    expect(chequeo.nivel).toBe("falla");
    expect(chequeo.detalle).toContain("HttpOnly");
    expect(chequeo.detalle).toContain("Secure");
    expect(porId(evaluarSondeo(sondeoListo({ ingreso: ok(200, htmlIngreso(), {}) })), "cookie").detalle).toContain("no dejó");
  });

  test("el panel sin sesión tiene que volver a ingresar", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "panel").nivel).toBe("pasa");
    expect(porId(evaluarSondeo(sondeoListo({ panel: ok(307, "", {}, `${ORIGEN}/ingresar`) })), "panel").nivel).toBe("pasa");
    expect(porId(evaluarSondeo(sondeoListo({ panel: ok(200, "panel") })), "panel").nivel).toBe("falla");
    expect(porId(evaluarSondeo(sondeoListo({ panel: ok(302, "", {}, "https://evil.test/ingresar") })), "panel").detalle).toContain("fuera del sitio");
  });

  test("los textos en borrador son advertencia y una URL http también", () => {
    const borrador = evaluarSondeo(
      sondeoListo({
        terminos: ok(200, "<p>Borrador de la beta</p>"),
        privacidad: ok(200, "<p>Borrador para revisión</p>"),
      }),
    );
    expect(porId(borrador, "textos-legales").nivel).toBe("advertencia");
    expect(porId(borrador, "textos-legales").detalle).toContain("Ley 21.719");
    expect(porId(evaluarSondeo(sondeoListo({ url: "http://localhost:3000" })), "direccion").nivel).toBe("advertencia");
    expect(codigoSalida(evaluarSondeo(sondeoListo({ url: "http://localhost:3000" })))).toBe(0);
  });

  test("observabilidad solo falla si acepta un cuerpo inválido", () => {
    expect(porId(evaluarSondeo(sondeoListo()), "observabilidad").nivel).toBe("pasa");
    expect(porId(evaluarSondeo(sondeoListo({ observabilidad: ok(200, "{}") })), "observabilidad").nivel).toBe("falla");
    expect(porId(evaluarSondeo(sondeoListo({ observabilidad: ok(429) })), "observabilidad").nivel).toBe("advertencia");
  });

  test("las cuentas demo que entran son advertencia y no imprimen la clave", () => {
    const entraron = evaluarCuentasDemo([
      { email: DEMO_ACCOUNTS[0], resultado: "entro" },
      rechazada(DEMO_ACCOUNTS[1]),
    ]);
    expect(entraron.nivel).toBe("advertencia");
    expect(entraron.detalle).toContain("entró con la clave del seed");
    expect(entraron.detalle).toContain("a propósito para la demo");
    expect(entraron.detalle).not.toContain(DEMO_PASSWORD);
    const informe = formatearInforme(ORIGEN, [entraron]);
    expect(informe).toContain("ADVERTENCIA");
    expect(informe).not.toContain(DEMO_PASSWORD);
    expect(codigoSalida([entraron])).toBe(0);

    const ritmo = evaluarCuentasDemo([
      { email: DEMO_ACCOUNTS[0], resultado: "no_concluyente", motivo: "el ingreso respondió ritmo (demasiados intentos). No se reintentó." },
      { email: DEMO_ACCOUNTS[1], resultado: "no_concluyente", motivo: "no se intentó para no sumar intentos: el ingreso ya respondió ritmo." },
    ]);
    expect(ritmo.nivel).toBe("advertencia");
    expect(ritmo.detalle).toContain("ritmo");
  });

  test("las cuentas y la clave coinciden con el seed", () => {
    const seed = readFileSync(new URL("../../prisma/seed.ts", import.meta.url), "utf8");
    expect(seed).toContain(`const DEMO_PASSWORD = "${DEMO_PASSWORD}"`);
    for (const email of DEMO_ACCOUNTS) expect(seed).toContain(email);
  });
});

describe("solicitudes", () => {
  test("el recorrido feliz solo pega al origen, con firmas inválidas, y no repite secretos", async () => {
    const { llamadas, fetchImpl } = sitio();
    const chequeos = await verificarProduccion(ORIGEN, fetchImpl);
    expect(codigoSalida(chequeos)).toBe(0);
    expect(porId(chequeos, "whatsapp").detalle).toContain("503");
    expect(JSON.stringify(chequeos)).not.toContain(DEMO_PASSWORD);
    expect(JSON.stringify(chequeos)).not.toContain(CSRF);

    expect(llamadas.every((llamada) => llamada.url.startsWith(`${ORIGEN}/`))).toBe(true);
    expect(llamadas.every((llamada) => llamada.init.redirect === "manual")).toBe(true);
    const urls = llamadas.map((llamada) => llamada.url);
    expect(urls.some((url) => url.includes("api.x.ai") || url.includes("mercadopago.com") || url.includes("flow.cl"))).toBe(false);
    expect(urls.some((url) => url.includes("/registro"))).toBe(false);

    const flow = llamadas.find((llamada) => llamada.url.includes("/api/flow/confirmacion"));
    expect(flow?.init.method).toBe("POST");
    expect(flow?.init.body).toBe("token=verificacion-solo-lectura&s=firma-invalida");

    const mercado = llamadas.filter((llamada) => llamada.url.includes("/api/mercadopago/webhook"));
    expect(mercado).toHaveLength(2);
    expect(mercado.every((llamada) => !llamada.url.includes("type=") && !llamada.url.includes("topic="))).toBe(true);
    expect(mercado.map((llamada) => llamada.init.body)).toEqual(["{}", "{}"]);
    const firmas = mercado.map((llamada) => new Headers(llamada.init.headers).get("x-signature"));
    expect(firmas.filter(Boolean)).toEqual(["ts=1000000000,v1=" + "0".repeat(64)]);

    const whatsapp = llamadas.find((llamada) => llamada.url.includes("/api/whatsapp") && llamada.init.method === "POST");
    expect(whatsapp?.init.body).toBe("{}");
    expect(new Headers(whatsapp?.init.headers).get("x-hub-signature-256")).toBe("sha256=" + "0".repeat(64));

    const obs = llamadas.find((llamada) => llamada.url.includes("/api/observabilidad"));
    expect(obs?.init.body).toContain('"source":"otro"');

    const ingresos = llamadas.filter((llamada) => new URL(llamada.url).pathname === "/ingresar" && llamada.init.method === "POST");
    expect(ingresos).toHaveLength(2);
    for (const ingreso of ingresos) {
      const headers = new Headers(ingreso.init.headers);
      expect(headers.get("cookie")).toBe(`bd_csrf=${CSRF}`);
      expect(headers.get("origin")).toBe(ORIGEN);
      expect(headers.get("cookie")).not.toContain("bd_session");
      expect(cuerpo(ingreso.init.body)).toContain(DEMO_PASSWORD);
    }
  });

  test("si la cuenta entra, la sesión no se reenvía ni se imprime", async () => {
    const sesion = "bd_session=SESION-NO-DEBE-SALIR; HttpOnly; Secure; SameSite=lax";
    const { llamadas, fetchImpl } = sitio((url, init) => {
      if (new URL(url).pathname === "/ingresar" && init?.method === "POST") {
        const email = cuerpo(init.body);
        const headers = new Headers({ location: "/panel" });
        headers.append("set-cookie", sesion);
        if (email.includes(DEMO_ACCOUNTS[0])) headers.append("set-cookie", `bd_csrf=${"d".repeat(32)}; HttpOnly; Secure; SameSite=lax`);
        return new Response(null, { status: 303, headers });
      }
      return null;
    });
    const chequeos = await verificarProduccion(ORIGEN, fetchImpl);
    expect(porId(chequeos, "cuentas-demo").nivel).toBe("advertencia");
    expect(JSON.stringify(chequeos)).not.toContain("SESION-NO-DEBE-SALIR");
    expect(JSON.stringify(chequeos)).not.toContain(DEMO_PASSWORD);
    const posts = llamadas.filter((llamada) => new URL(llamada.url).pathname === "/ingresar" && llamada.init.method === "POST");
    expect(posts).toHaveLength(2);
    expect(new Headers(posts[1]?.init.headers).get("cookie")).not.toContain("bd_session");
    expect(new Headers(posts[1]?.init.headers).get("cookie")).toBe(`bd_csrf=${"d".repeat(32)}`);
  });

  test("sin el formulario no manda la clave", async () => {
    const { llamadas, fetchImpl } = sitio((_url, _init, path) => {
      if (path === "/ingresar") return new Response("<form></form>", { status: 200, headers: { "set-cookie": COOKIE } });
      return null;
    });
    const chequeos = await verificarProduccion(ORIGEN, fetchImpl);
    expect(porId(chequeos, "cuentas-demo").nivel).toBe("advertencia");
    const posts = llamadas.filter((llamada) => llamada.init.method === "POST" && llamada.url.endsWith("/ingresar"));
    expect(posts).toHaveLength(0);
    expect(JSON.stringify(llamadas.map((llamada) => cuerpo(llamada.init.body)))).not.toContain(DEMO_PASSWORD);
  });

  test("un error de red no copia el mensaje crudo", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("falló SECRETO-TOKEN");
    };
    const chequeos = await verificarProduccion(ORIGEN, fetchImpl);
    expect(JSON.stringify(chequeos)).not.toContain("SECRETO-TOKEN");
    expect(porId(chequeos, "salud").detalle).toContain("no hubo respuesta");
    expect(codigoSalida(chequeos)).toBe(1);
  });

  test("si la espera se agota, la falla no arrastra el abort", async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("SECRETO-EN-EL-ABORT")));
      });
    const chequeos = await verificarProduccion(ORIGEN, fetchImpl, 30);
    expect(JSON.stringify(chequeos)).not.toContain("SECRETO");
    expect(porId(chequeos, "salud").detalle).toContain("la espera se agotó");
  });

  test("una URL con clave no dispara red", async () => {
    let llamadas = 0;
    const fetchImpl: FetchLike = async () => {
      llamadas += 1;
      return new Response("no");
    };
    const chequeos = await verificarProduccion("https://user:supersecreto@ejemplo.cl", fetchImpl);
    expect(llamadas).toBe(0);
    expect(JSON.stringify(chequeos)).not.toContain("supersecreto");
    expect(codigoSalida(chequeos)).toBe(1);
  });
});

function cuerpo(body: BodyInit | null | undefined) {
  if (typeof body === "string") return body;
  if (body instanceof FormData) return [...body.entries()].map(([key, value]) => `${key}=${String(value)}`).join("&");
  return "";
}

function sitio(ajustar?: (url: string, init: RequestInit | undefined, path: string) => Response | null) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const pedido = init ?? {};
    llamadas.push({ url, init: pedido });
    const path = new URL(url).pathname;
    const especial = ajustar?.(url, pedido, path);
    if (especial) return especial;
    return respuestaPorDefecto(url, pedido);
  };
  return { llamadas, fetchImpl };
}

function respuestaPorDefecto(url: string, init: RequestInit) {
  const path = new URL(url).pathname;
  const method = (init.method ?? "GET").toUpperCase();
  if (path === "/api/health") return json(200, { ok: true, servicio: "brazo-derecho", base: "ok" });
  if (path === "/api/mercadopago/webhook") return json(401, { ok: false });
  if (path === "/api/flow/confirmacion") return json(401, { ok: false });
  if (path === "/api/whatsapp" && method === "POST") return json(503, { ok: false, error: "Falta WHATSAPP_APP_SECRET" });
  if (path === "/api/whatsapp") return new Response(null, { status: 503 });
  if (path === "/ingresar" && method === "POST") {
    return new Response(null, { status: 303, headers: { location: "/ingresar?error=credenciales" } });
  }
  if (path === "/ingresar") {
    const headers = new Headers(cabecerasPlanas());
    headers.append("set-cookie", COOKIE);
    return new Response(htmlIngreso(), { status: 200, headers });
  }
  if (path === "/panel") return new Response(null, { status: 307, headers: { location: "/ingresar?siguiente=%2Fpanel" } });
  if (path === "/terminos" || path === "/privacidad") return new Response("<p>Texto revisado</p>", { status: 200 });
  if (path === "/api/observabilidad") return json(400, { ok: false });
  return new Response("no", { status: 404 });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cabecerasPlanas() },
  });
}

function cabecerasPlanas() {
  return {
    "content-security-policy": CSP,
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(self), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin-allow-popups",
    "x-dns-prefetch-control": "off",
  };
}
