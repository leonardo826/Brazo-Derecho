-- Encendido por empresa. No llama a un proveedor de nube.
CREATE TYPE "ComputerPowerStatus" AS ENUM ('OFF', 'STARTING', 'READY', 'STOPPING', 'ERROR');

CREATE TABLE "ComputerPower" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" "ComputerPowerStatus" NOT NULL DEFAULT 'OFF',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'static',
    "machineId" TEXT NOT NULL DEFAULT '',
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTaskCount" INTEGER NOT NULL DEFAULT 0,
    "powerOnAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerPower_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComputerPower_organizationId_key" ON "ComputerPower"("organizationId");

CREATE INDEX "ComputerPower_state_lastActivityAt_idx" ON "ComputerPower"("state", "lastActivityAt");

ALTER TABLE "ComputerPower" ADD CONSTRAINT "ComputerPower_activeTaskCount_check" CHECK ("activeTaskCount" >= 0);

ALTER TABLE "ComputerPower" ADD CONSTRAINT "ComputerPower_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ComputerPowerUse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "computerPowerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL,

    CONSTRAINT "ComputerPowerUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComputerPowerUse_organizationId_startedAt_idx" ON "ComputerPowerUse"("organizationId", "startedAt");

ALTER TABLE "ComputerPowerUse" ADD CONSTRAINT "ComputerPowerUse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComputerPowerUse" ADD CONSTRAINT "ComputerPowerUse_computerPowerId_fkey" FOREIGN KEY ("computerPowerId") REFERENCES "ComputerPower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
