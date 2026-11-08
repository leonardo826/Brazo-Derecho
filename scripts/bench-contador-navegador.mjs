/**
 * Mide el Contador en Chromium local contra un Next ya levantado.
 * El servidor tiene que ir con XAI_MODE=mock y sin clave de xAI.
 * No llama a un modelo de pago. Las pausas de CHAT_STREAM_CHUNK_MS son del simulador.
 *
 *   BASE_URL=http://127.0.0.1:3111 node scripts/bench-contador-navegador.mjs timing
 *   BASE_URL=http://127.0.0.1:3111 node scripts/bench-contador-navegador.mjs queue
 *   BASE_URL=http://127.0.0.1:3111 node scripts/bench-contador-navegador.mjs story
 */
import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const mode = process.argv[2] ?? "timing";
const samples = Number(process.env.BENCH_N ?? "20");
const password = "Clave-demo-2026";
const outDir = process.env.BENCH_OUT ?? "/tmp/contador-bench";

const hook = () => {
  localStorage.setItem("brazo-prueba-demo", "1");
};

async function arm(page) {
  await page.evaluate(() => {
    if (window.__benchReady) return;
    window.__benchReady = true;
    const visibleAssistants = () =>
      [...document.querySelectorAll(".agent-bubble.assistant, .confirm-card")].filter((node) => node.getClientRects().length > 0);
    window.__arm = () => {
      const nodes = visibleAssistants();
      const last = nodes.at(-1);
      window.__turn = {
        t0: performance.now(),
        paints: [],
        baseCount: nodes.length,
        lastBase: last ? last.innerText : "",
      };
    };
    const note = () => {
      const turn = window.__turn;
      if (!turn) return;
      const nodes = visibleAssistants();
      const lastNode = nodes.at(-1);
      const text = lastNode ? lastNode.innerText : "";
      const isNew = nodes.length > turn.baseCount || text !== turn.lastBase;
      if (!isNew) return;
      const saved = Boolean(lastNode?.querySelector("button, a"));
      const prev = turn.paints.at(-1);
      if (prev && prev.text === text && prev.saved === saved) return;
      turn.paints.push({ dt: Math.round(performance.now() - turn.t0), text, saved });
    };
    new MutationObserver(note).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

function pct(values, p) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil((p / 100) * clean.length) - 1));
  return clean[index];
}

function pack(rows, key) {
  const values = rows.map((row) => row[key]);
  const warm = rows.filter((row) => !row.cold).map((row) => row[key]);
  const cold = rows.find((row) => row.cold)?.[key] ?? null;
  return { frio: cold, tibioP50: pct(warm, 50), tibioP90: pct(warm, 90), max: pct(values, 100), n: values.filter((value) => Number.isFinite(value)).length };
}

async function register(page, email) {
  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill("Ana Bench");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByLabel("Nombre del negocio").fill("Bench Local");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await page.getByRole("button", { name: "Crear empresa" }).click();
  try {
    await page.waitForURL(/\/panel/, { timeout: 20_000 });
  } catch (error) {
    const url = page.url();
    if (url.includes("error=ritmo")) throw new Error("El registro local llegó al tope de ritmo. Hay que reiniciar el servidor de prueba.");
    throw error;
  }
}

async function openContador(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/panel/contador");
  const heading = page.getByRole("heading", { name: "Contador Auditor Chile" }).filter({ visible: true });
  const input = page.getByRole("textbox", { name: "Mensaje" }).filter({ visible: true });
  await heading.waitFor({ timeout: 20_000 });
  const ready = async () => input.isEnabled().catch(() => false);
  if (!(await ready())) {
    const activate = page.getByRole("button", { name: /Activar prueba|Empezar prueba/ }).filter({ visible: true });
    if (await activate.count()) {
      await activate.click();
      await page.waitForURL(/\/panel\/contador/, { timeout: 15_000 });
      await heading.waitFor();
    }
  }
  try {
    await page.waitForFunction(() => {
      const boxes = [...document.querySelectorAll("textarea[aria-label='Mensaje']")];
      return boxes.some((el) => el instanceof HTMLTextAreaElement && !el.disabled && el.getClientRects().length > 0);
    }, { timeout: 8_000 });
  } catch {
    await page.reload();
    await heading.waitFor();
    await page.waitForFunction(() => {
      const boxes = [...document.querySelectorAll("textarea[aria-label='Mensaje']")];
      return boxes.some((el) => el instanceof HTMLTextAreaElement && !el.disabled && el.getClientRects().length > 0);
    }, { timeout: 8_000 });
  }
  const quota = await page.locator(".contador-quota:visible").innerText();
  if (!quota.includes("de 30 tareas hoy")) throw new Error(`Cupo visible inesperado: ${quota}`);
  await arm(page);
}

async function send(page, text, needle) {
  const input = page.getByRole("textbox", { name: "Mensaje" }).filter({ visible: true });
  const http = { ttfb: null, done: null };
  const onResponse = (response) => {
    if (response.request().method() !== "POST" || !response.url().includes("/api/chat")) return;
    const timing = response.request().timing();
    http.ttfb = timing.responseStart;
    http.done = timing.responseEnd;
  };
  page.on("response", onResponse);
  await input.fill(text);
  await arm(page);
  await page.evaluate(() => window.__arm());
  await page.getByRole("button", { name: "Enviar", exact: true }).filter({ visible: true }).click();
  await page.waitForFunction(
    (expected) => {
      const nodes = [...document.querySelectorAll(".agent-bubble.assistant, .confirm-card")];
      return nodes.some((node) => node.getClientRects().length > 0 && (node.innerText || "").includes(expected) && node.querySelector("button, a"));
    },
    needle,
    { timeout: 25_000 },
  );
  page.off("response", onResponse);
  const turn = await page.evaluate(() => window.__turn);
  return { ...turn, http };
}

function readTurn(turn, needle) {
  const paints = turn?.paints ?? [];
  const useful = paints.filter((paint) => paint.text.includes(needle));
  const gaps = [];
  for (let index = 1; index < useful.length; index += 1) gaps.push(useful[index].dt - useful[index - 1].dt);
  const saved = [...paints].reverse().find((paint) => paint.saved && paint.text.includes(needle));
  return {
    ackHttp: turn?.http?.ttfb > 0 ? turn.http.ttfb : null,
    ackCliente: paints.find((paint) => /Preparando respuesta|Sigo con el siguiente/.test(paint.text))?.dt ?? null,
    ttftUtil: useful[0]?.dt ?? null,
    total: saved?.dt ?? null,
    pausaMax: gaps.length ? Math.max(...gaps) : 0,
  };
}

async function scenario(browser, name, text, needle, viewport) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(hook);
  const page = await context.newPage();
  const email = `bench-${name}-${Date.now()}@test.local`;
  await register(page, email);
  await openContador(page, viewport);
  const rows = [];
  for (let index = 0; index < samples; index += 1) {
    const turn = await send(page, text, needle);
    const row = readTurn(turn, needle);
    row.cold = index === 0;
    rows.push(row);
  }
  await context.close();
  return {
    escenario: name,
    motor: "simulador local, sin red xAI",
    n: rows.length,
    frio: "primera consulta de una sesión nueva",
    ackHttp: pack(rows, "ackHttp"),
    ackCliente: pack(rows, "ackCliente"),
    ttftUtil: pack(rows, "ttftUtil"),
    total: pack(rows, "total"),
    pausaMax: pack(rows, "pausaMax"),
  };
}

async function queueScenario(browser) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(hook);
  const page = await context.newPage();
  await register(page, `bench-cola-${Date.now()}@test.local`);
  await openContador(page, { width: 1440, height: 900 });
  const rows = [];
  const pairs = Math.floor(samples / 2);
  for (let index = 0; index < pairs; index += 1) {
    const stamp = `${index}-${Date.now().toString(36).slice(-4)}`;
    const first = `A${stamp} resume el IVA`;
    const second = `B${stamp} sigue con el F29`;
    const input = page.getByRole("textbox", { name: "Mensaje" });
    const sendButton = page.getByRole("button", { name: "Enviar", exact: true });
    const stop = page.getByRole("button", { name: "Detener respuesta", exact: true });
    await input.fill(first);
    const t0 = Date.now();
    await sendButton.click();
    await stop.waitFor({ timeout: 8_000 });
    const stopVisible = Date.now() - t0;
    await input.fill(second);
    const q0 = Date.now();
    await sendButton.click();
    await page.getByText("1 mensaje en espera").first().waitFor({ timeout: 8_000 });
    const cola = Date.now() - q0;
    await stop.click();
    await page.getByText("Detuviste la respuesta.").first().waitFor({ timeout: 8_000 });
    const detenido = Date.now() - q0;
    await page.locator(".agent-bubble.assistant").filter({ hasText: second }).waitFor({ timeout: 20_000 });
    const totalCola = Date.now() - q0;
    rows.push({ cold: index === 0, stopVisible, cola, detenido, totalCola });
  }
  const mic = page.getByRole("button", { name: "Micrófono" }).filter({ visible: true });
  const grabando = page.getByRole("button", { name: "Detener grabación" }).filter({ visible: true });
  await mic.click();
  const appeared = await Promise.race([
    grabando.waitFor({ timeout: 4_000 }).then(() => "grabando"),
    page.getByText("No pude usar el micrófono").waitFor({ timeout: 4_000 }).then(() => "aviso"),
  ]).catch(() => "sin-respuesta");
  if (appeared === "grabando") {
    await grabando.click();
    await mic.waitFor({ timeout: 4_000 });
  }
  await context.close();
  return {
    microfono: appeared === "grabando" ? "detener volvió al micrófono; no hay micrófono físico" : appeared,
    escenario: "cola-detener",
    motor: "simulador local. La pausa entre trozos es CHAT_STREAM_CHUNK_MS, no el modelo.",
    n: rows.length,
    stopVisible: pack(rows, "stopVisible"),
    cola: pack(rows, "cola"),
    detenido: pack(rows, "detenido"),
    totalCola: pack(rows, "totalCola"),
  };
}

function contrast(a, b) {
  const lin = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

async function story(browser) {
  await mkdir(`${outDir}/shots`, { recursive: true });
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await desktop.addInitScript(hook);
  const page = await desktop.newPage();
  await register(page, `bench-historia-${Date.now()}@test.local`);
  await openContador(page, { width: 1440, height: 900 });
  const simple = await send(page, "Resume el IVA en dos frases", "Respuesta de prueba");
  const explain = await send(page, "Explícame bien el F29", "Respuesta de prueba");
  const form = await send(page, "Guarda mi root para el SII", "formulario seguro");
  const formLink = await page.locator(".agent-bubble.assistant a[href='/panel/boveda?portal=sii#agregar-acceso']").last().getAttribute("href");
  const formText = await page.locator(".agent-bubble.assistant").filter({ visible: true }).last().innerText();
  await send(page, "Resume el IVA de una boleta en dos frases", "boleta");
  const last = await page.locator(".agent-bubble.assistant").last().innerText();
  const input = page.getByRole("textbox", { name: "Mensaje" });
  await input.focus();
  await input.fill("Enter escritorio IVA corto");
  await input.press("Enter");
  await page.locator(".agent-bubble.user").filter({ hasText: "Enter escritorio IVA corto" }).waitFor({ timeout: 8_000 });
  const enterSent = await page.locator(".agent-bubble.user").filter({ hasText: "Enter escritorio IVA corto" }).count();
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || "",
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
    };
  });
  await page.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/desktop-1440-historial.png` });
  const log = await page.evaluate(() => {
    const node = document.querySelector(".agent-log");
    if (!node) return null;
    const before = node.scrollTop;
    node.scrollTop = 0;
    const overflow = node.scrollHeight - node.clientHeight;
    return { before, overflow, client: node.clientHeight, scroll: node.scrollHeight };
  });
  const jump = page.getByRole("button", { name: "Volver al final" });
  let jumpOk = false;
  if (log && log.overflow > 8) {
    await jump.waitFor({ timeout: 3_000 });
    await page.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/desktop-1440-volver.png` });
    await jump.click();
    jumpOk = await page.evaluate(() => {
      const node = document.querySelector(".agent-log");
      if (!node) return false;
      return node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    });
  }
  await page.getByRole("button", { name: "Micrófono" }).click();
  const mic = await page.locator(".banner, [role=alert]").last().innerText().catch(() => "");
  const measure = await page.evaluate(() => {
    const pair = (selector, prop) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      const parent = getComputedStyle(el.parentElement ?? el);
      return {
        selector,
        fg: style[prop],
        bg: style.backgroundColor === "rgba(0, 0, 0, 0)" ? parent.backgroundColor : style.backgroundColor,
      };
    };
    return {
      title: pair(".contador-bar h1", "color"),
      quota: pair(".contador-quota", "color"),
      note: pair(".composer-note", "color"),
      send: pair(".composer-icon.send", "color"),
      user: pair(".agent-bubble.user", "color"),
      assistant: pair(".agent-bubble.assistant", "color"),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const contrastRows = {};
  for (const [key, value] of Object.entries(measure)) {
    if (!value || typeof value !== "object" || !value.fg) continue;
    const fg = value.fg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const bg = value.bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!fg || !bg) continue;
    contrastRows[key] = {
      ratio: Number(contrast(fg.slice(1).map(Number), bg.slice(1).map(Number)).toFixed(2)),
      fg: value.fg,
      bg: value.bg,
    };
  }
  await desktop.close();

  const mobile = await browser.newContext({ ...devices["Pixel 7"], baseURL, viewport: { width: 390, height: 844 } });
  await mobile.addInitScript(hook);
  const phone = await mobile.newPage();
  await register(phone, `bench-movil-${Date.now()}@test.local`);
  await openContador(phone, { width: 390, height: 844 });
  const coarse = await phone.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
  const mobileInput = phone.getByRole("textbox", { name: "Mensaje" });
  await mobileInput.fill("Esto no debe salir con Enter");
  await mobileInput.press("Enter");
  await phone.waitForTimeout(400);
  const mobileEnterCount = await phone.locator(".agent-bubble.user").count();
  await phone.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/mobile-390-vacio.png` });
  if (mobileEnterCount === 0) {
    await phone.getByRole("button", { name: "Enviar", exact: true }).click();
    await phone.locator(".agent-bubble.assistant").first().waitFor({ timeout: 20_000 });
  }
  await phone.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/mobile-390-respuesta.png` });
  const mobileOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mobile.close();

  return {
    motor: "simulador local, sin red xAI. Viewport, no un celular físico ni un micrófono físico.",
    simple: readTurn(simple, "Respuesta de prueba"),
    explicacion: readTurn(explain, "Respuesta de prueba"),
    formulario: {
      ...readTurn(form, "formulario seguro"),
      enlace: formLink,
      diceQueNoEntra: /No entré al portal|no inicia sesión/.test(formText),
    },
    siguienteNoRepiteElFormulario: !last.includes("/panel/boveda") && last.includes("boleta"),
    enterEscritorioEnvio: enterSent >= 1,
    foco: focus,
    log,
    volverAlFinal: jumpOk,
    microfonoAviso: mic,
    contraste: contrastRows,
    docOverflow: measure.docOverflow,
    movil: { pointerCoarse: coarse, enterNoEnvia: mobileEnterCount === 0, overflow: mobileOverflow },
  };
}

const browser = await chromium.launch();
const report = { baseURL, mode, medidoEn: new Date().toISOString(), simulador: true, grokBot: "N/D", inferenciaLive: "no corrida" };
if (mode === "timing") {
  report.simple = await scenario(browser, "simple", "Resume el IVA en dos frases", "Respuesta de prueba", { width: 1440, height: 900 });
  report.explicacion = await scenario(browser, "explicacion", "Explícame bien el F29", "Respuesta de prueba", { width: 1440, height: 900 });
  report.formulario = await scenario(
    browser,
    "formulario",
    "Guarda mi root para el SII",
    "formulario seguro",
    { width: 1440, height: 900 },
  );
}
if (mode === "queue") report.cola = await queueScenario(browser);
if (mode === "story") report.historia = await story(browser);
await browser.close();
await mkdir(outDir, { recursive: true });
const file = `${outDir}/${mode}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(file);
console.log(JSON.stringify(report, null, 2));
