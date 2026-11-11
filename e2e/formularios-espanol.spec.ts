import { expect, test } from "@playwright/test";
import { ensureAdmin, waitForHydration } from "./helpers";

test("registro vacío y con correo inválido muestra el aviso en español", async ({ page }) => {
  await page.goto("/registro");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Completa este campo." }).first()).toBeVisible();
  await expect(page.getByRole("alert", { name: "Marca esta casilla para continuar." })).toBeVisible();
  await expect(page.getByText("Please fill out this field.")).toHaveCount(0);

  await page.getByLabel("Tu nombre").fill("Ana Soto");
  await page.getByLabel("Correo").fill("sin-arroba");
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByLabel("Nombre del negocio").fill("Taller E2E");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("alert", { name: "Escribe un correo válido." })).toBeVisible();
  await expect(page.getByText(/Please include an @/)).toHaveCount(0);
});

test("ingresar vacío y con correo inválido muestra el aviso en español", async ({ page }) => {
  await page.goto("/ingresar");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Completa este campo." }).first()).toBeVisible();
  await expect(page.getByText("Please fill out this field.")).toHaveCount(0);

  await page.getByLabel("Correo").fill("sin-arroba");
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByRole("alert", { name: "Escribe un correo válido." })).toBeVisible();
  await expect(page.getByText(/Please include an @/)).toHaveCount(0);
});

test("el computador apagado responde 404 aunque haya sesión", async ({ page }) => {
  await ensureAdmin(page);
  const response = await page.goto("/panel/computador");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "No está esta página" })).toBeVisible();
});
