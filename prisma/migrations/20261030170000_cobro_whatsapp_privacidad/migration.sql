-- AlterTable
ALTER TABLE "User" ADD COLUMN "consentAt" TIMESTAMP(3),
ADD COLUMN "marketingOptInAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "flowCustomerId" TEXT,
ADD COLUMN "whatsappPhoneNumberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_flowCustomerId_key" ON "Organization"("flowCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_whatsappPhoneNumberId_key" ON "Organization"("whatsappPhoneNumberId");

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "flowSubscriptionId" TEXT,
ADD COLUMN "flowPlanId" TEXT,
ADD COLUMN "amountClp" INTEGER;

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN "model" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "externalId" TEXT,
ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'simulator';

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_organizationId_externalId_key" ON "Conversation"("organizationId", "externalId");

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- CreateTable
CREATE TABLE "FlowNotice" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "flowOrder" INTEGER,
    "paymentStatus" INTEGER,
    "organizationId" TEXT,
    "agent" "AgentKind",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowNotice_token_key" ON "FlowNotice"("token");
