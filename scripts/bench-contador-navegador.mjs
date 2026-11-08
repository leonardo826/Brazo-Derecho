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
import { classifyTurn } from "./bench-sample.mjs";

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
    if (window.__benchInstalled) return;
    window.__benchInstalled = true;
    window.__turns = [];
    window.__pending = null;
    const shown = (selector) => [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length > 0);
    const note = () => {
      const turn = window.__activeTurn;
      if (!turn) return;
      const assistants = shown(".agent-bubble.assistant, .confirm-card");
      if (turn.domEstado == null && assistants.some((node) => /Preparando respuesta|Sigo con el siguiente/.test(node.innerText))) {
        turn.domEstado = performance.now();
      }
      if (turn.kind === "form") {
        const links = shown("a[href*='agregar-acceso']").length;
        if (turn.domUtil == null && links > turn.linksBefore) turn.domUtil = performance.now();
      } else if (turn.domUtil == null && assistants.some((node) => node.innerText.includes(turn.token))) {
        turn.domUtil = performance.now();
      }
      if (turn.kind === "queue" && turn.domCola == null) {
        const queued = shown(".agent-bubble.user").some((node) => node.innerText.includes(turn.token) && /En espera/.test(node.innerText));
        if (queued) turn.domCola = performance.now();
      }
      if (turn.messageId && turn.domId == null && document.querySelector(`[data-message-id="${CSS.escape(turn.messageId)}"]`)) {
        turn.domId = performance.now();
      }
      if (turn.stopVisible == null && [...document.querySelectorAll("button.stop")].some((node) => node.getClientRects().length > 0)) {
        turn.stopVisible = performance.now();
      }
      const stopped = shown(".agent-bubble.assistant").filter((node) => /Detuviste la respuesta/.test(node.innerText)).length;
      for (const item of window.__turns || []) {
        if (item.stopClick != null && item.domStop == null && stopped > item.stoppedBefore) item.domStop = performance.now();
      }
    };
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("button.stop")) {
          const now = performance.now();
          const stopped = [...document.querySelectorAll(".agent-bubble.assistant")].filter((node) => node.getClientRects().length > 0 && /Detuviste la respuesta/.test(node.innerText)).length;
          const open = [...(window.__turns || [])].reverse().find((item) => item.sseDone == null);
          if (open && open.stopClick == null) {
            open.stopClick = now;
            open.stoppedBefore = stopped;
          }
          return;
        }
        const button = target?.closest("button.send");
        if (!button || !window.__pending) return;
        const pending = window.__pending;
        window.__pending = null;
        const turn = {
          token: pending.token,
          kind: pending.kind,
          linksBefore: shown("a[href*='agregar-acceso']").length,
          click: performance.now(),
          ackHttp: null,
          sseByte: null,
          sseUser: null,
          sseMessage: null,
          sseDone: null,
          httpEnd: null,
          messageId: null,
          domEstado: null,
          domUtil: null,
          domCola: null,
          domId: null,
        };
        window.__turns.push(turn);
        window.__activeTurn = turn;
      },
      true,
    );
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const turn = method === "POST" && url.includes("/api/chat") ? window.__activeTurn : null;
      const response = await original(input, init);
      if (!turn || !response.body) return response;
      turn.ackHttp = performance.now();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawByte = false;
      const stream = new ReadableStream({
        async pull(controller) {
          const step = await reader.read();
          if (step.done) {
            turn.httpEnd = performance.now();
            controller.close();
            return;
          }
          if (!sawByte) {
            sawByte = true;
            turn.sseByte = performance.now();
          }
          buffer += decoder.decode(step.value, { stream: true });
          let split = buffer.indexOf("\n\n");
          while (split >= 0) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = raw
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data) {
              try {
                const event = JSON.parse(data);
                const now = performance.now();
                if (event.type === "user" && turn.sseUser == null) turn.sseUser = now;
                if (event.type === "message" && event.message?.role === "ASSISTANT" && turn.sseMessage == null) {
                  turn.sseMessage = now;
                  turn.messageId = typeof event.message.id === "string" ? event.message.id : null;
                }
                if (event.type === "done" && turn.sseDone == null) turn.sseDone = now;
              } catch {
                // Un ping no es un evento.
              }
            }
            split = buffer.indexOf("\n\n");
          }
          controller.enqueue(step.value);
        },
      });
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    new MutationObserver(note).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  });
}

function pct(values, p) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil((p / 100) * clean.length) - 1));
  return clean[index];
}

function pack(rows, key, gate = "ok") {
  const chosen = rows.filter((row) => row[gate]);
  const values = chosen.map((row) => row[key]);
  const warm = chosen.filter((row) => !row.cold).map((row) => row[key]);
  const cold = chosen.find((row) => row.cold)?.[key] ?? null;
  return {
    frio: cold,
    tibioP50: pct(warm, 50),
    tibioP90: pct(warm, 90),
    max: pct(values, 100),
    nOk: values.filter((value) => Number.isFinite(value)).length,
    n: rows.length,
  };
}

function sampleId(prefix, index) {
  return `${prefix}-${index}-${Math.random().toString(16).slice(2, 8)}`;
}

function rowFrom(turn, cold) {
  const judged = classifyTurn(turn);
  return { ...judged, cold, ok: judged.completo };
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

async function send(page, text, kind, until = "done") {
  const input = page.getByRole("textbox", { name: "Mensaje" }).filter({ visible: true });
  const sendButton = page.getByRole("button", { name: "Enviar", exact: true }).filter({ visible: true });
  await input.fill(text);
  await page.evaluate(({ token, turnKind }) => {
    window.__pending = { token, kind: turnKind };
  }, { token: text, turnKind: kind });
  await sendButton.click();
  try {
    await page.waitForFunction(
      ({ token, mode }) => {
        const turn = (window.__turns || []).find((item) => item.token === token);
        if (!turn) return false;
        const stop = [...document.querySelectorAll("button.stop")].some((node) => node.getClientRects().length > 0);
        if (mode === "ack") return Boolean(turn.ackHttp) && stop;
        if (mode === "queue") return turn.domCola != null;
        return Boolean(turn.sseDone) && turn.domUtil != null && !stop;
      },
      { token: text, mode: until },
      { timeout: 25_000 },
    );
  } catch {
    return { ok: false, motivo: "timeout", cold: false, token: text };
  }
  const turn = await page.evaluate((token) => (window.__turns || []).find((item) => item.token === token) ?? null, text);
  return { ...rowFrom(turn, false), token: text };
}

async function scenario(browser, name, phrase, kind, viewport) {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(hook);
  const page = await context.newPage();
  await register(page, `bench-${name}-${Date.now()}@test.local`);
  await openContador(page, viewport);
  const rows = [];
  for (let index = 0; index < samples; index += 1) {
    const token = sampleId(name, index);
    const text = `${phrase} ${token}`;
    const row = await send(page, text, kind);
    row.cold = index === 0;
    rows.push(row);
    if (!row.ok) break;
  }
  await context.close();
  const failed = rows.filter((row) => !row.ok).length;
  return {
    escenario: name,
    motor: "simulador local, sin red xAI. El cambio de DOM no es un frame pintado.",
    nPlaneado: samples,
    nIntentos: rows.length,
    nDom: rows.filter((row) => row.domListo).length,
    nPersistido: rows.filter((row) => row.ok).length,
    nFallo: failed,
    motivos: rows.filter((row) => !row.ok).map((row) => row.motivo),
    reloj: "performance.now del clic del botón Enviar. El éxito completo exige el id guardado en el DOM.",
    ackHttp: pack(rows, "ackHttp"),
    primerByte: pack(rows, "sseByte"),
    domEstado: pack(rows, "domEstado", "domListo"),
    domCambio: pack(rows, "domCambio", "domListo"),
    servidorMensaje: pack(rows, "servidorMensaje"),
    servidorHecho: pack(rows, "servidorHecho"),
    domId: pack(rows, "domId"),
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
    const first = `ColaA ${sampleId("a", index)} resume el IVA`;
    const second = `ColaB ${sampleId("b", index)} sigue con el F29`;
    const opened = await send(page, first, "chat", "ack");
    if (!opened.ok && opened.motivo === "timeout") {
      rows.push({ ok: false, motivo: "timeout-abrir", cold: index === 0 });
      break;
    }
    const queued = await send(page, second, "queue", "queue");
    if (queued.motivo === "timeout") {
      rows.push({ ok: false, motivo: "timeout-cola", cold: index === 0 });
      break;
    }
    const stop = page.getByRole("button", { name: "Detener respuesta", exact: true }).first();
    await stop.click();
    try {
      await page.waitForFunction(
        (token) => {
          const turn = (window.__turns || []).find((item) => item.token === token);
          const stopButton = [...document.querySelectorAll("button.stop")].some((node) => node.getClientRects().length > 0);
          return Boolean(turn?.sseDone && turn.messageId && turn.domId != null && turn.domUtil != null) && !stopButton;
        },
        second,
        { timeout: 25_000 },
      );
    } catch {
      rows.push({ ok: false, motivo: "timeout-cola", cold: index === 0 });
      break;
    }
    const measured = await page.evaluate((tokens) => {
      const firstTurn = (window.__turns || []).find((item) => item.token === tokens.first);
      const secondTurn = (window.__turns || []).find((item) => item.token === tokens.second);
      const rel = (turn, value) => (turn && typeof value === "number" ? Math.round(value - turn.click) : null);
      return {
        stopVisible: rel(firstTurn, firstTurn?.stopVisible),
        cola: rel(secondTurn, secondTurn?.domCola),
        detenido: firstTurn && typeof firstTurn.domStop === "number" && typeof firstTurn.stopClick === "number" ? Math.round(firstTurn.domStop - firstTurn.stopClick) : null,
        totalCola: rel(secondTurn, secondTurn?.sseDone),
        secondDone: Boolean(secondTurn?.sseDone && secondTurn.messageId && secondTurn.domId != null && secondTurn.domUtil != null),
      };
    }, { first, second });
    const ok = measured.secondDone && measured.cola != null && measured.cola >= 0 && measured.totalCola != null && measured.totalCola >= measured.cola;
    rows.push({ ok, motivo: ok ? "ok" : "secuencia-o-muestra-incompleta", cold: index === 0, ...measured });
    if (!ok) break;
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
    motor: "simulador local, sin red xAI. CHAT_STREAM_CHUNK_MS es una pausa inyectada, no inferencia.",
    nPlaneado: pairs,
    nOk: rows.filter((row) => row.ok).length,
    nFallo: rows.filter((row) => !row.ok).length,
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
  const simple = await send(page, `Resume el IVA ${sampleId("hist", 1)} en dos frases`, "chat");
  const explain = await send(page, `Explicame ${sampleId("hist", 2)} bien el F29`, "chat");
  const form = await send(page, `Guarda mi root para el SII ${sampleId("hist", 3)}`, "form");
  const formLink = await page.locator(".agent-bubble.assistant:visible a[href='/panel/boveda?portal=sii#agregar-acceso']").last().getAttribute("href");
  const formText = await page.locator(".agent-bubble.assistant:visible").last().innerText();
  const follow = await send(page, `Resume el IVA de una boleta ${sampleId("hist", 4)} en dos frases`, "chat");
  const last = await page.locator(".agent-bubble.assistant:visible").last().innerText();
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
  const avisos = await page.evaluate(() => {
    const root = [...document.querySelectorAll(".contador-screen")].find((node) => node.getClientRects().length > 0);
    const text = root?.innerText ?? "";
    return {
      aviso: (text.match(/No reemplaza a un contador certificado/g) || []).length,
      norma: (text.match(/Normativa verificada/gi) || []).length,
      simulado: (text.match(/Ejemplo simulado/g) || []).length,
    };
  });
  if (avisos.aviso !== 1 || avisos.norma !== 0) {
    throw new Error(`Aviso redundante o normativa fingida: ${JSON.stringify(avisos)}`);
  }
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
  await phone.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/mobile-390-simple.png` });
  await send(phone, `Guarda mi root para el SII ${sampleId("movil", 2)}`, "form");
  await phone.locator(".contador-screen:visible").screenshot({ path: `${outDir}/shots/mobile-390-form.png` });
  const movilAvisos = await phone.evaluate(() => {
    const root = [...document.querySelectorAll(".contador-screen")].find((node) => node.getClientRects().length > 0);
    const text = root?.innerText ?? "";
    return {
      aviso: (text.match(/No reemplaza a un contador certificado/g) || []).length,
      norma: (text.match(/Normativa verificada/gi) || []).length,
    };
  });
  const mobileOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await mobile.close();

  return {
    motor: "simulador local, sin red xAI. Viewport, no un celular físico ni un micrófono físico.",
    simpleOk: simple.ok === true,
    explicacionOk: explain.ok === true,
    formulario: {
      ok: form.ok === true,
      enlace: formLink,
      diceQueNoEntra: /No entré al portal|no inicia sesión/.test(formText),
    },
    siguienteOk: follow.ok === true,
    siguienteNoRepiteElFormulario: !last.includes("/panel/boveda") && last.includes("boleta") && !/normativa verificada/i.test(last),
    enterEscritorioEnvio: enterSent >= 1,
    foco: focus,
    log,
    volverAlFinal: jumpOk,
    microfonoAviso: mic,
    contraste: contrastRows,
    docOverflow: measure.docOverflow,
    avisos,
    movil: { pointerCoarse: coarse, enterNoEnvia: mobileEnterCount === 0, overflow: mobileOverflow, avisos: movilAvisos },
  };
}

const browser = await chromium.launch();
const report = { baseURL, mode, medidoEn: new Date().toISOString(), simulador: true, grokBot: "N/D", inferenciaLive: "no corrida" };
if (mode === "timing") {
  report.invalidoEn642b017 = "Esa corrida cerraba con una burbuja vieja y mezclaba dos relojes. No es un resultado.";
  report.simple = await scenario(browser, "simple", "Resume el IVA", "chat", { width: 1440, height: 900 });
  report.explicacion = await scenario(browser, "explicacion", "Explicame bien el F29", "chat", { width: 1440, height: 900 });
  report.formulario = await scenario(browser, "formulario", "Guarda mi root para el SII", "form", { width: 1440, height: 900 });
}
if (mode === "queue") report.cola = await queueScenario(browser);
if (mode === "story") report.historia = await story(browser);
await browser.close();
await mkdir(outDir, { recursive: true });
const file = `${outDir}/${mode}.json`;
await writeFile(file, JSON.stringify(report, null, 2));
console.log(file);
console.log(JSON.stringify(report, null, 2));
