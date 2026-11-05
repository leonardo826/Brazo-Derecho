import { expect, test, type Page } from "@playwright/test";
import { assertBubbleSides, assertChatDock } from "./contador-ui";
import { clickHydrated, ensureAdmin } from "./helpers";

async function openContador(page: Page, viewport: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem("brazo-prueba-demo", "1");
  });
  await page.setViewportSize(viewport);
  await ensureAdmin(page);
  await page.goto("/panel/contador");
  // The loading shell has no form. waitForHydration can return before this page arrives.
  await expect(page.getByRole("heading", { name: "Contador Auditor Chile" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Mensaje" });
  await expect(input).toBeVisible();
  if (await input.isEnabled()) return;

  // The admin spec suspends this company and reactivates it. If that lands late, the
  // composer stays disabled and the trial button is hidden because the plan is already open.
  if (await page.getByText("Tu empresa está suspendida").isVisible()) {
    await page.goto("/panel/admin");
    const row = page.getByRole("row", { name: /Administración E2E/ });
    await clickHydrated(page, row.getByRole("button", { name: "Reactivar" }), async () => {
      await expect(page.getByText("Empresa reactivada")).toBeVisible({ timeout: 3_000 });
    });
    await page.goto("/panel/contador");
    await expect(page.getByRole("heading", { name: "Contador Auditor Chile" })).toBeVisible();
    if (await input.isEnabled()) return;
  }

  const activate = page.getByRole("button", { name: /Activar prueba|Empezar prueba|Suscribir con Flow|Registrar tarjeta/ }).first();
  await expect(activate).toBeVisible();
  await clickHydrated(page, activate, async () => {
    await expect(input).toBeEnabled({ timeout: 5_000 });
  });
}

async function consultsNow(page: Page) {
  const raw = await page.getByRole("meter", { name: "Consultas de este mes" }).getAttribute("aria-valuenow");
  return Number(raw ?? "0");
}

test("se puede escribir mientras el contador responde, encolar y detener", async ({ page }) => {
  test.setTimeout(120_000);
  await openContador(page, { width: 412, height: 900 });
  const before = await consultsNow(page);
  // The first streamed chunk is 48 characters and includes only the start of the question.
  const stamp = Date.now().toString(36).slice(-5);
  const alfa = `A${stamp}`;
  const beta = `B${stamp}`;
  const input = page.getByRole("textbox", { name: "Mensaje" });
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  const stop = page.getByRole("button", { name: "Detener respuesta", exact: true });

  await input.fill(`${alfa} boleta IVA en el F29`);
  await send.click();
  await expect(stop).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill(`${beta} cola del F29 de abril`);
  await expect(send).toBeEnabled();

  const bar = page.locator(".composer-bar:visible");
  const attach = page.locator(".composer-bar:visible .file-button");
  const mic = page.getByRole("button", { name: "Micrófono" });
  await expect(attach).toBeVisible();
  await expect(mic).toBeVisible();
  await expect(stop).toBeVisible();
  const boxes = await Promise.all([attach.boundingBox(), input.boundingBox(), mic.boundingBox(), stop.boundingBox(), send.boundingBox()]);
  expect(boxes.every(Boolean)).toBe(true);
  const centers = boxes.map((box) => box!.y + box!.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(24);
  const barBox = await bar.boundingBox();
  expect(barBox!.height).toBeLessThan(90);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await send.click();
  await expect(page.getByText("1 mensaje en espera")).toBeVisible();
  const queued = page.locator(".agent-bubble.user:visible").filter({ hasText: beta }).filter({ hasText: "En espera" });
  await expect(queued).toBeVisible();
  const streaming = page.locator(".agent-bubble.assistant:visible").filter({ hasText: alfa });
  await expect(streaming).toBeVisible({ timeout: 20_000 });
  await expect(stop).toBeVisible();
  const liveBox = await streaming.boundingBox();
  const queuedBox = await queued.boundingBox();
  expect(liveBox!.y).toBeLessThan(queuedBox!.y);

  await stop.click();
  const stopped = page.locator(".agent-bubble.assistant:visible").filter({ hasText: alfa }).filter({ hasText: "Detuviste la respuesta." });
  await expect(stopped).toBeVisible();
  await expect(stopped).not.toContainText("No alcancé a responder");
  await expect(page.locator(".agent-bubble.assistant:visible").filter({ hasText: beta })).toBeVisible({
    timeout: 20_000,
  });
  await expect(stop).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect
    .poll(async () => consultsNow(page), { timeout: 20_000 })
    .toBe(before + 1);

  await assertBubbleSides(page);
  await assertChatDock(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await assertChatDock(page);
  const gama = `G${stamp}`;
  const stoppedBefore = await page.getByText("Detuviste la respuesta.").count();
  await input.fill(`${gama} detener en el escritorio`);
  await send.click();
  await expect(stop).toBeVisible();
  await expect(input).toBeEnabled();
  await input.fill("puedo seguir escribiendo");
  await expect(send).toBeEnabled();
  const desktopBar = await page.locator(".composer-bar:visible").boundingBox();
  expect(desktopBar!.height).toBeLessThan(90);
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  await stop.click();
  await expect(page.getByText("Detuviste la respuesta.")).toHaveCount(stoppedBefore + 1);
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("puedo seguir escribiendo");
  await expect(stop).toHaveCount(0);
  await expect.poll(async () => consultsNow(page), { timeout: 15_000 }).toBe(before + 1);
});
