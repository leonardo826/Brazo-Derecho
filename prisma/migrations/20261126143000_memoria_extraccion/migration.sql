-- CreateTable
CREATE TABLE "MemoryExtraction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryExtraction_organizationId_createdAt_idx" ON "MemoryExtraction"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemoryExtraction" ADD CONSTRAINT "MemoryExtraction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
