-- Arriendo alcanzable por empresa. No crea máquinas ni guarda el token en claro.
ALTER TABLE "Computer" ADD COLUMN "agentEndpoint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Computer" ADD COLUMN "agentTokenCiphertext" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Computer" ADD COLUMN "agentTokenIv" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Computer" ADD COLUMN "agentTokenAuthTag" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX "Computer_machineId_key" ON "Computer"("machineId") WHERE "machineId" <> '';
