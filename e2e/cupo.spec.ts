import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { clickHydrated, DEMO_PASSWORD } from "./helpers";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
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

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true },
  });
  if (!user?.memberships[0]) throw new Error("No quedó la cuenta de prueba");
  await prisma.usageEvent.create({
    data: {
      organizationId: user.memberships[0].organizationId,
      agent: "WHATSAPP",
      metric: "RESPONSES",
      quantity: 800,
    },
  });

  await page.goto("/panel");
  await expect(
    page.getByText("Vas al 80% del cupo de respuestas de Atención WhatsApp. Si llegas al 100%"),
  ).toBeVisible();
});
