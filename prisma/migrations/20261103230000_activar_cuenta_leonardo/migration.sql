-- Activa la cuenta cliente de Leonardo (correo con 'torresanisidro'). Idempotente; no hace nada si no existe.
UPDATE "User" SET "emailVerifiedAt" = now()
WHERE "email" ILIKE '%torresanisidro%' AND "emailVerifiedAt" IS NULL;

UPDATE "Subscription" s
SET "status" = 'ACTIVE', "periodStart" = now(), "periodEnd" = now() + interval '1 month'
WHERE s."organizationId" IN (
  SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u."id" = m."userId"
  WHERE u."email" ILIKE '%torresanisidro%'
);

INSERT INTO "Subscription" ("id", "organizationId", "agent", "status", "periodStart", "periodEnd", "provider", "amountClp", "createdAt")
SELECT gen_random_uuid()::text, o.id, 'ACCOUNTING', 'ACTIVE', now(), now() + interval '1 month', 'MERCADOPAGO', 53538, now()
FROM (
  SELECT DISTINCT m."organizationId" AS id FROM "Membership" m JOIN "User" u ON u."id" = m."userId"
  WHERE u."email" ILIKE '%torresanisidro%'
) o
ON CONFLICT ("organizationId", "agent") DO UPDATE
SET "status" = 'ACTIVE', "periodStart" = now(), "periodEnd" = now() + interval '1 month';

UPDATE "Organization" SET "suspendedAt" = NULL
WHERE "id" IN (
  SELECT m."organizationId" FROM "Membership" m JOIN "User" u ON u."id" = m."userId"
  WHERE u."email" ILIKE '%torresanisidro%'
);
