import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, ensureAdmin } from "./helpers";

function tour(page: Page) {
  return page.getByRole("region", { name: "Prueba la demo" });
}

test("Prueba la demo guía el panel, se cierra y se puede volver a abrir", async ({ page }) => {
  await ensureAdmin(page);
  const card = tour(page);
  await expect(card.getByRole("heading", { name: "Prueba la demo" })).toBeVisible();
  await expect(card.getByText("no sale ningún mensaje a un celular")).toBeVisible();
  await expect(page.locator("a.tour-target", { hasText: "Inicio" })).toBeVisible();

  await clickHydrated(page, card.getByRole("button", { name: "Siguiente" }), async () => {
    await expect(card.getByRole("heading", { name: "Tres agentes, por separado" })).toBeVisible({ timeout: 3_000 });
  });
  await expect(page).toHaveURL(/\/panel$/);

  await clickHydrated(page, card.getByRole("button", { name: "Siguiente" }), async () => {
    await expect(page).toHaveURL(/\/panel\/whatsapp$/, { timeout: 3_000 });
  });
  await expect(card.getByRole("heading", { name: "Atiende como en el mesón" })).toBeVisible();
  await expect(page.locator("a.tour-target", { hasText: "Atención WhatsApp" })).toBeVisible();
  await expect(card.getByText("no llega a un celular")).toBeVisible();

  await clickHydrated(page, card.getByRole("button", { name: "Atrás" }), async () => {
    await expect(page).toHaveURL(/\/panel$/, { timeout: 3_000 });
  });
  await expect(card.getByRole("heading", { name: "Tres agentes, por separado" })).toBeVisible();

  await clickHydrated(page, card.getByRole("button", { name: "Siguiente" }), async () => {
    await expect(page).toHaveURL(/\/panel\/whatsapp$/, { timeout: 3_000 });
  });
  await clickHydrated(page, card.getByRole("button", { name: "Siguiente" }), async () => {
    await expect(page).toHaveURL(/\/panel\/cotizador$/, { timeout: 3_000 });
  });
  await expect(card.getByText("No se envía sola")).toBeVisible();
  await clickHydrated(page, card.getByRole("button", { name: "Siguiente" }), async () => {
    await expect(page).toHaveURL(/\/panel\/marketing$/, { timeout: 3_000 });
  });
  await expect(card.getByRole("heading", { name: "Deja un borrador listo" })).toBeVisible();
  await clickHydrated(page, card.getByRole("button", { name: "Listo" }), async () => {
    await expect(card).toBeHidden({ timeout: 3_000 });
  });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Marketing" })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await clickHydrated(page, page.getByRole("button", { name: "Prueba la demo" }), async () => {
    await expect(page).toHaveURL(/\/panel$/, { timeout: 3_000 });
    await expect(tour(page).getByRole("heading", { name: "Prueba la demo" })).toBeVisible();
  });

  await page.keyboard.press("Escape");
  await expect(tour(page)).toBeHidden();
  await page.reload();
  await expect(tour(page)).toHaveCount(0);
});

test("el recorrido cabe en 360 px y los botones se pueden tocar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await ensureAdmin(page);
  const card = tour(page);
  await expect(card).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  for (const name of ["Ahora no", "Siguiente"]) {
    const box = await card.getByRole("button", { name }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(361);
  }

  await clickHydrated(page, card.getByRole("button", { name: "Ahora no" }), async () => {
    await expect(card).toBeHidden({ timeout: 3_000 });
  });
  const reopen = page.getByRole("button", { name: "Prueba la demo" });
  await expect(reopen).toBeVisible();
  const reopenBox = await reopen.boundingBox();
  expect(reopenBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect((reopenBox?.x ?? 0) + (reopenBox?.width ?? 0)).toBeLessThanOrEqual(361);
});
