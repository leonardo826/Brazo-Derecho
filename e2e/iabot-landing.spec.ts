import { expect, test } from "@playwright/test";

test("la landing de IA Bot tiene una sola acción principal", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tu oficina, ordenada por IA." })).toBeVisible();
  await expect(page.getByText("Precio de lanzamiento: pronto")).toBeVisible();
  await expect(page.locator(".iabot-price")).toHaveCount(0);

  const primary = page.locator("a.iabot-cta");
  await expect(primary).toHaveCount(2);
  const labels = (await primary.allTextContents()).map((label) => label.trim());
  expect(new Set(labels)).toEqual(new Set(["Probar gratis 7 días"]));
  await expect(page.locator(".iabot a.button, .iabot a.button-link, .iabot button")).toHaveCount(0);

  await primary.first().click();
  await expect(page).toHaveURL(/\/registro$/);

  await page.goto("/");
  await page.getByRole("link", { name: "Ya tengo cuenta" }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
  await expect(page.getByRole("link", { name: "Ya tengo una cuenta: entrar con Google" })).toBeVisible();
});
