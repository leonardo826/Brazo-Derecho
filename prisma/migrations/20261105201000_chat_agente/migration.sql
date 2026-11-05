-- CreateEnum
CREATE TYPE "AgentMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "AgentMessageKind" AS ENUM ('TEXT', 'CONFIRMATION');

-- CreateEnum
CREATE TYPE "AgentConfirmation" AS ENUM ('PENDING', 'APPROVED', 'CANCELED');

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "AgentMessageRole" NOT NULL,
    "kind" "AgentMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "actionTitle" TEXT NOT NULL DEFAULT '',
    "confirmation" "AgentConfirmation",
    "legacyConsultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentThread_organizationId_agent_key" ON "AgentThread"("organizationId", "agent");

-- CreateIndex
CREATE INDEX "AgentThread_organizationId_idx" ON "AgentThread"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_legacyConsultId_key" ON "AgentMessage"("legacyConsultId");

-- CreateIndex
CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAttachment_messageId_idx" ON "AgentAttachment"("messageId");

-- CreateIndex
CREATE INDEX "AgentAttachment_organizationId_idx" ON "AgentAttachment"("organizationId");

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAttachment" ADD CONSTRAINT "AgentAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
