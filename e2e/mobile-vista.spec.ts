import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, ensureAdmin, waitForHydration } from "./helpers";

const outDir = path.join(process.cwd(), "artifacts", "mobile");
const widths = [360, 390, 414] as const;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

async function expectFits(page: Page) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    let offender = "";
    if (overflow > 1) {
      let widest = 0;
      for (const node of document.body.querySelectorAll<HTMLElement>("*")) {
        const width = node.getBoundingClientRect().width;
        if (width > widest) {
          widest = width;
          offender = `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 80)} ${Math.round(width)}px`;
        }
      }
    }
    return { overflow, offender };
  });
  expect(result.overflow, result.offender).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await mkdir(outDir, { recursive: true });
});

test("la beta cabe en 360, 390 y 414 px y deja capturas", async ({ page }) => {
  test.setTimeout(180_000);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tu brazo derecho, con reglas claras." })).toBeVisible();
    const cta = page.getByRole("link", { name: "Crear la cuenta de mi empresa" }).first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
    await expectFits(page);
    if (width !== 390) await shot(page, `01-landing-${width}`);

    await page.goto("/agentes");
    await expect(page.getByRole("heading", { name: "Tres agentes, cada uno con su trabajo." })).toBeVisible();
    await expectFits(page);
    await page.goto("/precios");
    await expect(page.getByRole("heading", { name: "Precios claros, en pesos chilenos." })).toBeVisible();
    await expectFits(page);
    await page.goto("/registro");
    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(page.getByText("Mínimo 8 caracteres, con una letra y un número.")).toBeVisible();
    await expectFits(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await shot(page, "01-landing");
  await page.goto("/agentes");
  await shot(page, "02-agentes");
  await page.goto("/precios");
  await shot(page, "03-precios");
  await page.goto("/registro");
  await shot(page, "04-registro");

  // El alta permite 5 cuentas por hora y por IP. El resto de la suite ya las usa.
  // Esta vista entra con la cuenta de administración, que el proyecto de escritorio deja creada.
  await ensureAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/panel/empezar");
  await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible();
  await expectFits(page);
  await shot(page, "05-wizard-empresa");

  await clickHydrated(page, page.getByRole("button", { name: "Seguir" }), async () => {
    await expect(page.getByRole("heading", { name: "Elige con cuál partir" })).toBeVisible({ timeout: 3_000 });
  });
  await expectFits(page);
  await shot(page, "06-wizard-agente");

  await page.locator("a.choice", { hasText: "Atención WhatsApp" }).click();
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: /Prueba Atención WhatsApp/ })).toBeVisible();
  await expectFits(page);
  await shot(page, "07-wizard-prueba");

  await page.getByRole("button", { name: "Activar prueba y probar" }).click();
  await expect(page.getByRole("heading", { name: "Atención WhatsApp" })).toBeVisible();
  await page.getByLabel("Título").fill("Horario");
  await page.getByLabel("Texto que puede usar").fill("El sábado abrimos de 9:00 a 14:00.");
  await clickHydrated(page, page.getByRole("button", { name: "Guardar ficha" }), async () => {
    await expect(page.getByText("Información guardada")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Quién escribe").fill("Cliente del mesón");
  await clickHydrated(page, page.getByRole("button", { name: "Abrir hilo" }), async () => {
    await expect(page.getByRole("link", { name: "Cliente del mesón" }).first()).toBeVisible({ timeout: 3_000 });
  });
  await waitForHydration(page);
  // El valor y el envío van en el mismo turno: si no, el formulario se vuelve a pintar y el texto se pierde.
  await page.getByLabel("Mensaje del cliente").evaluate((el) => {
    const textarea = el as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, "¿A qué hora abren el sábado?");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    if (!textarea.form) throw new Error("El mensaje no está en un formulario");
    textarea.form.requestSubmit();
  });
  await expect(page.getByRole("log", { name: "Mensajes del hilo" })).toContainText("9:00", { timeout: 20_000 });
  await expectFits(page);
  await shot(page, "08-chat");

  await page.goto("/panel");
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  const tour = page.getByRole("region", { name: "Prueba la demo" });
  await expect(tour).toBeVisible();
  await expect(tour.getByRole("heading", { name: "Prueba la demo" })).toBeVisible();
  const siguiente = tour.getByRole("button", { name: "Siguiente" });
  const siguienteBox = await siguiente.boundingBox();
  expect(siguienteBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((siguienteBox?.x ?? 0) + (siguienteBox?.width ?? 0)).toBeLessThanOrEqual(391);
  await expectFits(page);
  await shot(page, "09-panel");

  await page.goto("/panel/pago?agente=WHATSAPP&volver=/panel");
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await expect(page.getByText("simula el pago de Flow")).toBeVisible();
  await expect(page.getByLabel(/tarjeta/i)).toHaveCount(0);
  await expectFits(page);
  await shot(page, "10-pago");

  await page.goto("/panel/admin");
  await expect(page.getByRole("heading", { name: "Empresas" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Costo estimado" })).toBeVisible();
  await expectFits(page);
  await shot(page, "11-admin");

  for (const width of [360, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/panel");
    await expectFits(page);
    await shot(page, `09-panel-${width}`);
    await page.goto("/panel/whatsapp");
    await expect(page.getByRole("heading", { name: "Atención WhatsApp" })).toBeVisible();
    await expectFits(page);
    await shot(page, `08-chat-${width}`);
    await page.goto("/panel/admin");
    await expectFits(page);
    await shot(page, `11-admin-${width}`);
  }
});
