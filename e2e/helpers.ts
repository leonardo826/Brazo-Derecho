import { expect, type Locator, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "Clave-demo-2026";
export const ADMIN_EMAIL = "admin-e2e@brazo.cl";

export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    if (!form) return document.readyState === "complete";
    return Object.keys(form).some((key) => key.startsWith("__reactProps") || key.startsWith("__reactFiber"));
  });
}

async function recoverBlankPanel(page: Page) {
  // A veces el cliente actualiza la URL y pierde el contenido. Recargar muestra lo que ya quedó guardado.
  if (!page.url().includes("/panel")) return;
  if ((await page.locator(".panel-main h1").count()) === 0) await page.reload();
}

export async function clickHydrated(page: Page, button: Locator, seen: () => Promise<void>) {
  await expect(async () => {
    await recoverBlankPanel(page);
    await waitForHydration(page);
    await button.click();
    try {
      await seen();
    } catch (error) {
      if (page.url().includes("/panel") && (await page.locator(".panel-main h1").count()) === 0) {
        await page.reload();
        await seen();
        return;
      }
      throw error;
    }
  }).toPass();
}

export async function logout(page: Page) {
  await clickHydrated(page, page.getByRole("button", { name: "Salir" }), async () => {
    await expect(page.getByRole("heading", { name: "Tu brazo derecho, con reglas claras." })).toBeVisible({
      timeout: 3_000,
    });
  });
}

export async function ensureAdmin(page: Page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
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
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
  await page.getByLabel("Nombre del negocio").fill("Administración E2E");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await page.getByRole("button", { name: "Crear empresa" }).click();
  await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible();
}
