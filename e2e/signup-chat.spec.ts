import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, waitForHydration } from "./helpers";

async function signup(page: Page, input: { email: string; organization: string; name: string }) {
  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill(input.name);
  await page.getByLabel("Correo").fill(input.email);
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByLabel("Nombre del negocio").fill(input.organization);
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Crear empresa" }), async () => {
    await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible({ timeout: 3_000 });
  });
}

test("registro, prueba y conversación con el agente", async ({ page }) => {
  const email = `e2e-${Date.now()}@ejemplo.cl`;
  await signup(page, { email, organization: "Taller E2E", name: "Ana Pérez" });

  await clickHydrated(page, page.getByRole("button", { name: "Seguir" }), async () => {
    await expect(page.getByRole("heading", { name: "Elige con cuál partir" })).toBeVisible({ timeout: 3_000 });
  });
  await page.locator("a.choice", { hasText: "Atención WhatsApp" }).click();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Activar prueba y probar" }).click();

  await expect(page.getByRole("heading", { name: "Atención WhatsApp" })).toBeVisible();
  await expect(page.getByText("La prueba de 14 días quedó activa")).toBeVisible();

  await page.getByLabel("Título").fill("Horario de atención");
  await page.getByLabel("Texto que puede usar").fill("Abrimos de lunes a viernes de 9:00 a 19:00 y los sábados de 9:00 a 14:00.");
  await clickHydrated(page, page.getByRole("button", { name: "Guardar ficha" }), async () => {
    await expect(page.getByText("Información guardada")).toBeVisible({ timeout: 3_000 });
  });

  await page.getByLabel("Quién escribe").fill("Cliente de prueba");
  await clickHydrated(page, page.getByRole("button", { name: "Abrir hilo" }), async () => {
    await expect(page.getByRole("link", { name: "Cliente de prueba" })).toBeVisible({ timeout: 3_000 });
  });

  await page.getByLabel("Mensaje del cliente").fill("¿A qué hora abren el sábado?");
  await clickHydrated(page, page.getByRole("button", { name: "Pedir respuesta" }), async () => {
    await expect(page.locator(".thread")).toContainText("asistente virtual", { timeout: 3_000 });
  });
  await expect(page.locator(".thread")).toContainText("asistente virtual");
  await expect(page.locator(".thread")).toContainText("9:00");
});
