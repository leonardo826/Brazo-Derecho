import { expect, test } from "@playwright/test";
import { clickHydrated, ensureAdmin, waitForHydration } from "./helpers";

test("elige Mercado Pago en el pago de prueba y activa el plan", async ({ page }) => {
  test.setTimeout(90_000);
  await ensureAdmin(page);
  const tour = page.getByRole("region", { name: "Prueba la demo" });
  if (await tour.isVisible()) {
    await tour.getByRole("button", { name: "Ahora no" }).click();
    await expect(tour).toBeHidden();
  }

  await page.goto("/panel/empezar");
  await clickHydrated(page, page.getByRole("button", { name: "Seguir" }), async () => {
    await expect(page.getByRole("heading", { name: "Elige con cuál partir" })).toBeVisible({ timeout: 3_000 });
  });
  await page.locator("a.choice", { hasText: "Atención WhatsApp" }).click();
  await waitForHydration(page);
  await expect(page.getByRole("radio", { name: /Flow/ })).toBeChecked();
  await expect(page.getByText("modo prueba").first()).toBeVisible();
  await page.getByRole("radio", { name: /Mercado Pago/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Activar prueba y probar" }), async () => {
    await expect(page.getByRole("heading", { name: "Atención WhatsApp", exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("La prueba de 14 días quedó activa")).toBeVisible();
  });

  await page.goto("/panel");
  await page.locator("article.panel-card", { hasText: "Atención WhatsApp" }).getByRole("link", { name: "Activar plan" }).click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Flow/ })).toBeChecked();
  await page.getByRole("radio", { name: /Mercado Pago/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Confirmar pago de prueba" }), async () => {
    await expect(page.getByText("Plan activo. El pago fue de prueba")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.locator("article.panel-card", { hasText: "Atención WhatsApp" }).getByText(/Activa hasta/)).toBeVisible();
});
