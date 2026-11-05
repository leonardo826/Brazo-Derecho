-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('TASK', 'CHAT', 'COMPUTER_STEP');

-- CreateTable
CREATE TABLE "UsageMeter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMonth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "tasksCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageMonth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageMeter_organizationId_createdAt_idx" ON "UsageMeter"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageMeter_organizationId_kind_createdAt_idx" ON "UsageMeter"("organizationId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMonth_organizationId_yearMonth_key" ON "UsageMonth"("organizationId", "yearMonth");

-- CreateIndex
CREATE INDEX "UsageMonth_organizationId_idx" ON "UsageMonth"("organizationId");

-- AddForeignKey
ALTER TABLE "UsageMeter" ADD CONSTRAINT "UsageMeter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMonth" ADD CONSTRAINT "UsageMonth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
