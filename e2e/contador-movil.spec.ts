import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, ensureAdmin, waitForHydration } from "./helpers";

const outDir = path.join(process.cwd(), "artifacts", "contador");

async function assertChatDock(page: Page) {
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Contador Auditor Chile" })).toBeVisible();
  await expect(page.getByText("Mensaje", { exact: true })).toHaveCount(0);
  await expect(page.locator(".usage-bar, .bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar" })).toHaveCount(0);
  await expect(page.locator(".agent-composer .composer-actions")).toHaveCount(0);

  const log = page.getByRole("log", { name: "Mensajes" });
  // Next deja una copia oculta del HTML. El layout se mide en la barra visible.
  const bar = page.locator(".composer-bar:visible");
  await expect(log).toBeVisible();
  await expect(bar).toBeVisible();

  const logBox = await log.boundingBox();
  const barBox = await bar.boundingBox();
  expect(logBox).toBeTruthy();
  expect(barBox).toBeTruthy();
  expect(logBox!.height).toBeGreaterThan(160);
  expect(logBox!.y + logBox!.height).toBeLessThanOrEqual(barBox!.y + 4);
  expect(barBox!.height).toBeLessThan(90);
  expect(barBox!.y + barBox!.height).toBeGreaterThan(viewport!.height - 120);
  expect(barBox!.width).toBeGreaterThan(viewport!.width * 0.55);

  const attach = page.locator(".composer-bar:visible .file-button");
  const input = page.getByRole("textbox", { name: "Mensaje" });
  const mic = page.getByRole("button", { name: "Micrófono" });
  const send = page.getByRole("button", { name: "Enviar", exact: true });
  await expect(attach).toBeVisible();
  await expect(input).toBeVisible();
  await expect(mic).toBeVisible();
  await expect(send).toBeVisible();

  const boxes = await Promise.all([attach.boundingBox(), input.boundingBox(), mic.boundingBox(), send.boundingBox()]);
  expect(boxes.every(Boolean)).toBe(true);
  const [attachBox, inputBox, micBox, sendBox] = boxes as NonNullable<(typeof boxes)[number]>[];
  const centers = [attachBox, inputBox, micBox, sendBox].map((box) => box.y + box.height / 2);
  const top = Math.min(...centers);
  const bottom = Math.max(...centers);
  expect(bottom - top).toBeLessThan(24);
  expect(attachBox.x).toBeLessThan(inputBox.x);
  expect(inputBox.x).toBeLessThan(micBox.x);
  expect(micBox.x).toBeLessThan(sendBox.x);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("el contador es un chat continuo en el celular y en el escritorio", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(outDir, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("brazo-prueba-demo", "1");
  });

  await page.setViewportSize({ width: 412, height: 900 });
  await ensureAdmin(page);
  await page.goto("/panel/contador");
  await waitForHydration(page);

  const activate = page.getByRole("button", { name: /Activar prueba|Empezar prueba|Suscribir con Flow|Registrar tarjeta/ });
  if (await activate.isVisible().catch(() => false)) {
    await clickHydrated(page, activate, async () => {
      await expect(page.getByRole("textbox", { name: "Mensaje" })).toBeEnabled({ timeout: 3_000 });
    });
  }

  await assertChatDock(page);

  const input = page.getByRole("textbox", { name: "Mensaje" });
  if (await input.isEnabled()) {
    await input.fill("¿El IVA de una boleta afecta el F29?");
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const userBubble = page.locator(".agent-bubble.user:visible").filter({ hasText: "boleta afecta" });
    await expect(userBubble.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".agent-bubble.assistant:visible").filter({ hasText: "Respuesta de prueba" }).first()).toBeVisible({
      timeout: 20_000,
    });
    const userAlign = await page.locator(".agent-row.user:visible").last().evaluate((el) => getComputedStyle(el).justifyContent);
    const assistantAlign = await page
      .locator(".agent-row.assistant:visible")
      .last()
      .evaluate((el) => getComputedStyle(el).justifyContent);
    expect(userAlign).toBe("flex-end");
    expect(assistantAlign).toBe("flex-start");
    await assertChatDock(page);
    await input.fill("¿Y el F29 de abril?");
  }

  const currentNav = page.getByRole("link", { name: "Contador Auditor" });
  const currentBox = await currentNav.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(currentBox).toBeTruthy();
  expect(currentBox!.x).toBeGreaterThanOrEqual(0);
  expect(currentBox!.x + currentBox!.width).toBeLessThanOrEqual(width + 1);

  await page.screenshot({ path: path.join(outDir, "contador-412.png") });

  await page.setViewportSize({ width: 1280, height: 800 });
  await assertChatDock(page);
  const side = await page.locator(".panel-side").boundingBox();
  expect(side?.width ?? 0).toBeGreaterThan(180);
  await page.screenshot({ path: path.join(outDir, "contador-1280.png") });
});
