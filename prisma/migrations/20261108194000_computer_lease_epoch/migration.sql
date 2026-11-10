-- Versión del arriendo y dirección fijada. No crea máquinas.
ALTER TABLE "Computer" ADD COLUMN "agentPinnedAddress" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Computer" ADD COLUMN "leaseEpoch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ComputerLeaseAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "leaseEpoch" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComputerLeaseAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComputerLeaseAudit_organizationId_createdAt_idx" ON "ComputerLeaseAudit"("organizationId", "createdAt");
