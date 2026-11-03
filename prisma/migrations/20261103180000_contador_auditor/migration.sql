-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'ACCOUNTING';

-- AlterEnum
ALTER TYPE "UsageMetric" ADD VALUE 'CONSULTS';

-- CreateTable
CREATE TABLE "AccountingConsult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingConsult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingConsult_organizationId_createdAt_idx" ON "AccountingConsult"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountingConsult" ADD CONSTRAINT "AccountingConsult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
