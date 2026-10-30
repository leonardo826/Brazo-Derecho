import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin-e2e@brazo.cl";
const PASSWORD = "Clave-demo-2026";

async function ensureAdmin(page: Page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  try {
    await page.waitForURL(/\/panel/, { timeout: 8_000 });
    return;
  } catch {
    const message = await page.locator(".banner").textContent().catch(() => "");
    if (!page.url().includes("error=credenciales") && message && !message.includes("no coinciden")) {
      throw new Error(`No se pudo ingresar: ${page.url()} ${message ?? ""}`);
    }
  }

  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill("Admin E2E");
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByLabel("Nombre del negocio").fill("Administración E2E");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible();
}

test("administración lista empresas y suspende", async ({ page }) => {
  await ensureAdmin(page);
  await page.goto("/panel/admin");
  await expect(page.getByRole("heading", { name: "Empresas" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Costo estimado" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Suscripciones" })).toBeVisible();

  const row = page.getByRole("row", { name: /Administración E2E/ });
  if (await row.getByRole("button", { name: "Reactivar" }).isVisible()) {
    await row.getByRole("button", { name: "Reactivar" }).click();
    await expect(row.getByRole("button", { name: "Suspender" })).toBeVisible();
  }
  await row.getByRole("button", { name: "Suspender" }).click();
  await expect(page).toHaveURL(/ok=suspendida/);
  await expect(page.getByText("Empresa suspendida. Los agentes quedan detenidos")).toBeVisible();
  await expect(row.getByRole("button", { name: "Reactivar" })).toBeVisible();

  await expect(async () => {
    if (!page.url().includes("ok=reactivada")) {
      await row.getByRole("button", { name: "Reactivar" }).click();
    }
    await expect(page).toHaveURL(/ok=reactivada/, { timeout: 2_000 });
  }).toPass();
  await expect(page.getByText("Empresa reactivada")).toBeVisible();
});
