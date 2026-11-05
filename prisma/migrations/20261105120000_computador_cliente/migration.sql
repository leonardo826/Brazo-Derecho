-- Computador por cliente. No crea máquinas en Fly.
CREATE TYPE "ComputerStatus" AS ENUM ('PENDING', 'PROVISIONING', 'RUNNING', 'STOPPED', 'NEEDS_QR', 'ERROR');

CREATE TYPE "ComputerTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TABLE "Computer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "flyApp" TEXT NOT NULL DEFAULT '',
    "machineId" TEXT NOT NULL DEFAULT '',
    "volumeId" TEXT NOT NULL DEFAULT '',
    "status" "ComputerStatus" NOT NULL DEFAULT 'PENDING',
    "region" TEXT NOT NULL DEFAULT 'gru',
    "novncTokenHash" TEXT NOT NULL DEFAULT '',
    "novncExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Computer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Computer_clientId_key" ON "Computer"("clientId");

CREATE INDEX "Computer_status_idx" ON "Computer"("status");

CREATE TABLE "ComputerTask" (
    "id" TEXT NOT NULL,
    "computerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" "ComputerTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComputerTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComputerTask_clientId_createdAt_idx" ON "ComputerTask"("clientId", "createdAt");

CREATE INDEX "ComputerTask_computerId_idx" ON "ComputerTask"("computerId");

ALTER TABLE "Computer" ADD CONSTRAINT "Computer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ComputerTask" ADD CONSTRAINT "ComputerTask_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "Computer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
