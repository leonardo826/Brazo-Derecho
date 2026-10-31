import { expect, test } from "@playwright/test";
import { clickHydrated, ensureAdmin } from "./helpers";

test("administración lista empresas y suspende", async ({ page }) => {
  await ensureAdmin(page);
  await page.goto("/panel/admin");
  await expect(page.getByRole("heading", { name: "Empresas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Costo por empresa" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Costo estimado" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Suscripciones" })).toBeVisible();

  const row = page.getByRole("row", { name: /Administración E2E/ });
  if (await row.getByRole("button", { name: "Reactivar" }).isVisible()) {
    await clickHydrated(page, row.getByRole("button", { name: "Reactivar" }), async () => {
      await expect(row.getByRole("button", { name: "Suspender" })).toBeVisible({ timeout: 3_000 });
    });
  }
  await clickHydrated(page, row.getByRole("button", { name: "Suspender" }), async () => {
    await expect(page).toHaveURL(/ok=suspendida/, { timeout: 3_000 });
    await expect(page.getByText("Empresa suspendida. Los agentes quedan detenidos")).toBeVisible();
    await expect(row.getByRole("button", { name: "Reactivar" })).toBeVisible();
  });

  await clickHydrated(page, row.getByRole("button", { name: "Reactivar" }), async () => {
    await expect(page).toHaveURL(/ok=reactivada/, { timeout: 3_000 });
    await expect(page.getByText("Empresa reactivada")).toBeVisible();
  });
});
