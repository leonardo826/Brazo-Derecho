import { expect, test, type Page } from "@playwright/test";
import { clickHydrated, DEMO_PASSWORD, ensureAdmin, logout, waitForHydration } from "./helpers";

async function mailLink(page: Page, email: string, subject: string) {
  const block = page.locator("details").filter({ hasText: email }).filter({ hasText: subject }).first();
  await expect(block).toBeVisible();
  await block.locator("summary").click();
  const text = await block.locator("pre").innerText();
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error(`Sin enlace en «${subject}» para ${email}`);
  return match[0];
}

test("recorrido de la demo: catálogo, alta, agentes, uso, cuenta y clave", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `recorrido-${Date.now()}@ejemplo.cl`;
  const organization = "Taller Recorrido";

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tu brazo derecho, con reglas claras." })).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Agentes" }).click();
  await expect(page).toHaveURL(/\/agentes$/);
  await expect(page.getByRole("heading", { name: "Tres agentes, cada uno con su trabajo." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atención WhatsApp" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cotizador" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Marketing" })).toBeVisible();
  await expect(page.getByText("$39.990").first()).toBeVisible();
  await expect(page.getByText("Qué no hace").first()).toBeVisible();
  await expect(page.getByText("No cobra ni pide datos de tarjeta", { exact: true })).toBeVisible();
  await expect(page.getByText("No inventa precios", { exact: true })).toBeVisible();
  await expect(page.getByText("No publica solo", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Precios" }).click();
  await expect(page).toHaveURL(/\/precios$/);
  await expect(page.getByRole("heading", { name: "Precios claros, en pesos chilenos." })).toBeVisible();
  await expect(page.getByText("$49.990").first()).toBeVisible();
  await expect(page.getByText("$34.990").first()).toBeVisible();
  await expect(page.getByText("$47.588").first()).toBeVisible();
  await page.locator("summary", { hasText: "¿Los precios incluyen IVA?" }).click();
  await expect(page.getByText("El IVA es 19%")).toBeVisible();
  await page.getByRole("link", { name: "Crear la cuenta de mi empresa" }).click();
  await expect(page).toHaveURL(/\/registro/);

  await page.getByLabel("Tu nombre").fill("Ana Recorrido");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
  await page.getByLabel("Nombre del negocio").fill(organization);
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Crear empresa" }), async () => {
    await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByText("Tu correo todavía no está confirmado")).toBeVisible();
  await clickHydrated(page, page.getByRole("button", { name: "Reenviar enlace" }), async () => {
    await expect(page.getByText("Te reenviamos el enlace")).toBeVisible({ timeout: 3_000 });
  });

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
    await expect(page.getByRole("link", { name: "Cliente de prueba" }).first()).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Mensaje del cliente").fill("¿A qué hora abren el sábado?");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Pedir respuesta" }).click();
  try {
    await expect(page.locator(".thread")).toContainText("9:00", { timeout: 8_000 });
  } catch {
    await page.reload();
    await expect(page.locator(".thread")).toContainText("9:00");
  }
  await expect(page.locator(".thread")).toContainText("asistente virtual");

  await page.goto("/panel/cotizador");
  await clickHydrated(page, page.getByRole("button", { name: "Activar prueba de 14 días" }), async () => {
    await expect(page.getByText("Prueba activada por 14 días.")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("SKU").fill("TOR-E2E");
  await page.getByLabel("Precio neto CLP").fill("1990");
  await page.getByLabel("Nombre").fill("Tornillo de prueba");
  await page.getByLabel("Unidad").fill("unidad");
  await clickHydrated(page, page.getByRole("button", { name: "Agregar a la lista" }), async () => {
    await expect(page.getByText("Producto guardado")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Cliente").fill("Cliente E2E");
  await page.getByLabel("Producto de la lista").selectOption({ index: 1 });
  await clickHydrated(page, page.getByRole("button", { name: "Armar cotización" }), async () => {
    await expect(page.getByText("Cotización armada")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByText("Pendiente de aprobación")).toBeVisible();

  await page.goto("/panel/marketing");
  await clickHydrated(page, page.getByRole("button", { name: "Activar prueba de 14 días" }), async () => {
    await expect(page.getByText("Prueba activada por 14 días.")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Voz").fill("cercana y clara");
  await page.getByLabel("Público").fill("dueños de casa en Santiago");
  await page.getByLabel("Resumen del negocio").fill("Taller de barrio con repuestos a pedido.");
  await clickHydrated(page, page.getByRole("button", { name: "Guardar perfil" }), async () => {
    await expect(page.getByText("Perfil de marca guardado")).toBeVisible({ timeout: 3_000 });
  });
  await page.getByLabel("Cuántos borradores").fill("1");
  await clickHydrated(page, page.getByRole("button", { name: "Preparar borradores" }), async () => {
    await expect(page.getByText("Borradores listos")).toBeVisible({ timeout: 3_000 });
  });
  await expect(page.getByText("Borrador").first()).toBeVisible();

  await page.goto("/panel/uso");
  await expect(page.getByRole("heading", { name: /Uso de / })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Respuestas" })).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByRole("meter", { name: "Cotizaciones" })).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByRole("meter", { name: "Textos" })).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByRole("meter", { name: "Imágenes" })).toHaveAttribute("aria-valuenow", "1");

  await page.goto("/panel/cuenta");
  await expect(page.getByRole("heading", { name: organization })).toBeVisible();
  await expect(page.getByText("El correo todavía no está confirmado")).toBeVisible();
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  await logout(page);
  await page.goto("/ingresar");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "¿Olvidaste tu contraseña?" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await clickHydrated(page, page.getByRole("button", { name: "Enviar enlace" }), async () => {
    await expect(page.getByText("Si ese correo tiene una cuenta")).toBeVisible({ timeout: 3_000 });
  });

  await ensureAdmin(page);
  await page.goto("/panel/admin");
  const correos = page.locator("section").filter({ has: page.getByRole("heading", { name: "Correos" }) });
  await expect(correos.getByText("No hay clave de Resend")).toBeVisible();
  const verifyUrl = await mailLink(page, email, "Confirma tu correo en Brazo Derecho");
  const resetUrl = await mailLink(page, email, "Recupera tu contraseña de Brazo Derecho");
  await logout(page);

  await page.goto(verifyUrl);
  await clickHydrated(page, page.getByRole("button", { name: "Confirmar mi correo" }), async () => {
    await expect(page.getByText("Correo confirmado")).toBeVisible({ timeout: 3_000 });
  });

  await page.goto(resetUrl);
  await page.getByLabel("Contraseña nueva").fill("Clave-nueva-2026");
  await clickHydrated(page, page.getByRole("button", { name: "Guardar contraseña" }), async () => {
    await expect(page.getByText("Contraseña actualizada")).toBeVisible({ timeout: 3_000 });
  });

  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.getByText("no coinciden")).toBeVisible();

  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill("Clave-nueva-2026");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await expect(page.getByText("Tu correo todavía no está confirmado")).toHaveCount(0);
  await page.goto("/panel/cuenta");
  await expect(page.getByText(/Correo confirmado el/)).toBeVisible();
});
