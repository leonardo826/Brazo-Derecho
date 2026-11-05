-- Bóveda de claves por empresa. El secreto queda solo en ciphertext (AES-256-GCM).

CREATE TYPE "CredentialAuditKind" AS ENUM ('CREATE', 'DELETE', 'USE', 'CONFIRM');

CREATE TYPE "CredentialRiskAction" AS ENUM ('DECLARAR', 'PAGAR');

CREATE TABLE "ClientCredential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "portal" TEXT NOT NULL,
    "usernameHint" TEXT NOT NULL DEFAULT '',
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ClientCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientCredential_organizationId_createdAt_idx" ON "ClientCredential"("organizationId", "createdAt");

CREATE TABLE "CredentialAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "credentialLabel" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "kind" "CredentialAuditKind" NOT NULL,
    "purpose" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CredentialAuditEvent_organizationId_createdAt_idx" ON "CredentialAuditEvent"("organizationId", "createdAt");

CREATE TABLE "CredentialConfirmation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "CredentialRiskAction" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CredentialConfirmation_organizationId_actorUserId_action_idx" ON "CredentialConfirmation"("organizationId", "actorUserId", "action");

CREATE TABLE "CredentialFillGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "allowedCredentialIds" TEXT[] NOT NULL,
    "purpose" TEXT NOT NULL,
    "highRisk" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialFillGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CredentialFillGrant_tokenHash_key" ON "CredentialFillGrant"("tokenHash");

CREATE INDEX "CredentialFillGrant_organizationId_expiresAt_idx" ON "CredentialFillGrant"("organizationId", "expiresAt");

ALTER TABLE "ClientCredential" ADD CONSTRAINT "ClientCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CredentialAuditEvent" ADD CONSTRAINT "CredentialAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CredentialConfirmation" ADD CONSTRAINT "CredentialConfirmation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CredentialFillGrant" ADD CONSTRAINT "CredentialFillGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
