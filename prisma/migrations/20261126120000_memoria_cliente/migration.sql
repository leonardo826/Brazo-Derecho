-- CreateTable
CREATE TABLE "MemoryFact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agent" "AgentKind",
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MemoryFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryFact_organizationId_deletedAt_idx" ON "MemoryFact"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "MemoryFact_organizationId_agent_deletedAt_idx" ON "MemoryFact"("organizationId", "agent", "deletedAt");

-- CreateIndex
CREATE INDEX "MemoryFact_organizationId_contentHash_idx" ON "MemoryFact"("organizationId", "contentHash");

-- Una sola copia activa del mismo dato por empresa. Lo borrado no entra.
CREATE UNIQUE INDEX "MemoryFact_active_hash_key" ON "MemoryFact"("organizationId", "contentHash") WHERE "deletedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "MemoryFact" ADD CONSTRAINT "MemoryFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
