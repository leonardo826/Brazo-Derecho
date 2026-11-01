-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('FLOW', 'MERCADOPAGO');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'FLOW',
ADD COLUMN "mpPreapprovalId" TEXT,
ADD COLUMN "mpPayerEmail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_mpPreapprovalId_key" ON "Subscription"("mpPreapprovalId");

-- CreateTable
CREATE TABLE "MercadoPagoNotice" (
    "id" TEXT NOT NULL,
    "noticeKey" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MercadoPagoNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MercadoPagoNotice_noticeKey_key" ON "MercadoPagoNotice"("noticeKey");

-- CreateIndex
CREATE INDEX "MercadoPagoNotice_subscriptionId_idx" ON "MercadoPagoNotice"("subscriptionId");
