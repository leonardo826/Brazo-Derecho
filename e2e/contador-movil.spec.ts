import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { assertBubbleSides, assertChatDock } from "./contador-ui";
import { clickHydrated, ensureAdmin, waitForHydration } from "./helpers";

const outDir = path.join(process.cwd(), "artifacts", "contador");

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
    await assertBubbleSides(page);
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
  if (await page.locator(".agent-bubble.assistant").filter({ hasText: "Respuesta de prueba" }).count()) {
    await assertBubbleSides(page);
  }
  const side = await page.locator(".panel-side").boundingBox();
  expect(side?.width ?? 0).toBeGreaterThan(180);
  await page.screenshot({ path: path.join(outDir, "contador-1280.png") });
});
