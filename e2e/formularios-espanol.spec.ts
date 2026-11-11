import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test("registro vacío y con correo inválido muestra el aviso en español", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/registro");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Completa este campo." }).first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Marca esta casilla para continuar." })).toBeVisible();
  await expect(page.getByText("Please fill out this field.")).toHaveCount(0);

  await page.getByLabel("Tu nombre").fill("Ana Soto");
  await page.getByLabel("Correo").fill("sin-arroba");
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByLabel("Nombre del negocio").fill("Taller E2E");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Escribe un correo válido." })).toBeVisible();
  await expect(page.getByText(/Please include an @/)).toHaveCount(0);

  await page.getByLabel("Correo").fill("ana@tuempresa.cl");
  await page.getByLabel("Contraseña").fill("corta");
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Usa al menos 8 caracteres." })).toBeVisible();
});

test("ingresar vacío y con correo inválido muestra el aviso en español", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/ingresar");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Completa este campo." }).first()).toBeVisible();
  await expect(page.getByText("Please fill out this field.")).toHaveCount(0);

  await page.getByLabel("Correo").fill("sin-arroba");
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Escribe un correo válido." })).toBeVisible();
  await expect(page.getByText(/Please include an @/)).toHaveCount(0);
});
