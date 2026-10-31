import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { clickHydrated, DEMO_PASSWORD } from "./helpers";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://brazo:brazo@127.0.0.1:5432/brazo_derecho",
});

test.afterAll(async () => {
  await pool.end();
});

test("avisa en el panel al llegar al 80% del cupo del plan", async ({ page }) => {
  const email = `cupo-${Date.now()}@ejemplo.cl`;
  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill("Ana Cupo");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
  await page.getByLabel("Nombre del negocio").fill("Taller del Cupo");
  await page.getByRole("checkbox", { name: /Términos del Servicio/ }).check();
  await clickHydrated(page, page.getByRole("button", { name: "Crear empresa" }), async () => {
    await expect(page.getByRole("heading", { name: "Deja listo tu primer agente" })).toBeVisible({ timeout: 3_000 });
  });

  const found = await pool.query<{ organizationId: string }>(
    `SELECT m."organizationId"
     FROM "User" u
     JOIN "Membership" m ON m."userId" = u.id
     WHERE u.email = $1
     LIMIT 1`,
    [email],
  );
  const organizationId = found.rows[0]?.organizationId;
  if (!organizationId) throw new Error("No quedó la cuenta de prueba");
  await pool.query(
    `INSERT INTO "UsageEvent" (id, "organizationId", agent, metric, quantity)
     VALUES ($1, $2, 'WHATSAPP', 'RESPONSES', 800)`,
    [randomBytes(12).toString("hex"), organizationId],
  );

  await page.goto("/panel");
  await expect(
    page.getByText("Vas al 80% del cupo de respuestas de Atención WhatsApp. Si llegas al 100%"),
  ).toBeVisible();
});
