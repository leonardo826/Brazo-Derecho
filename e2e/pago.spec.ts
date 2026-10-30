import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, waitForHydration } from "./helpers";

async function signup(page: Page) {
  const email = `pago-${Date.now()}@ejemplo.cl`;
  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill("Ana Pago");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill("Clave-demo-2026");
  await page.getByLabel("Nombre del negocio").fill("Taller del Pago");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Crear empresa" }), async () => {
    await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible({ timeout: 3_000 });
  });
}

function whatsappCard(page: Page) {
  return page.locator("article.panel-card", { hasText: "Atención WhatsApp" });
}

test("registro, agente, pago de prueba, chat y panel", async ({ page }) => {
  test.setTimeout(120_000);
  await signup(page);
  await clickHydrated(page, page.getByRole("button", { name: "Seguir" }), async () => {
    await expect(page.getByRole("heading", { name: "Elige con cuál partir" })).toBeVisible({ timeout: 3_000 });
  });
  await page.locator("a.choice", { hasText: "Atención WhatsApp" }).click();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Activar prueba y probar" }).click();
  await expect(page.getByRole("heading", { name: "Atención WhatsApp" })).toBeVisible();
  await expect(page.getByText("La prueba de 14 días quedó activa")).toBeVisible();

  await page.goto("/panel");
  await whatsappCard(page).getByRole("link", { name: "Activar plan" }).click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await expect(page.getByText("No se cobra, no pedimos tarjeta")).toBeVisible();
  await expect(page.getByLabel(/tarjeta/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Cancelar" }).click();
  await expect(page.getByText("Cancelaste el pago de prueba. La prueba de 14 días sigue activa.")).toBeVisible();
  await expect(whatsappCard(page).getByText(/Prueba hasta/)).toBeVisible();

  await whatsappCard(page).getByRole("link", { name: "Activar plan" }).click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await clickHydrated(page, page.getByRole("button", { name: "Confirmar pago de prueba" }), async () => {
    await expect(page.getByText("Plan activo. El pago fue de prueba")).toBeVisible({ timeout: 3_000 });
  });
  await expect(whatsappCard(page).getByText(/Activa hasta/)).toBeVisible();

  await page.goto("/panel/whatsapp");
  await page.getByLabel("Título").fill("Horario de atención");
  await page.getByLabel("Texto que puede usar").fill("Abrimos de lunes a viernes de 9:00 a 19:00 y los sábados de 9:00 a 14:00.");
  await clickHydrated(page, page.getByRole("button", { name: "Guardar ficha" }), async () => {
    await expect(page.getByText("Información guardada")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Quién escribe").fill("Cliente de prueba");
  await clickHydrated(page, page.getByRole("button", { name: "Abrir hilo" }), async () => {
    await expect(page.getByRole("link", { name: "Cliente de prueba" }).first()).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Mensaje del cliente").fill("¿A qué hora abren el sábado?");
  await clickHydrated(page, page.getByRole("button", { name: "Pedir respuesta" }), async () => {
    await expect(page.locator(".thread")).toContainText("asistente virtual", { timeout: 3_000 });
  });
  await expect(page.locator(".thread")).toContainText("9:00");

  await page.goto("/panel");
  await expect(whatsappCard(page).getByText(/Activa hasta/)).toBeVisible();
  await clickHydrated(page, whatsappCard(page).getByRole("button", { name: "Cancelar" }), async () => {
    await expect(page.getByText("Suscripción cancelada. El agente quedó detenido.")).toBeVisible({ timeout: 3_000 });
  });
  await expect(whatsappCard(page).getByText("Suscripción cancelada")).toBeVisible();
});
