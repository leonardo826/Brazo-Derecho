import { prisma } from "@/lib/prisma";
import type { CredentialRepo, NewAudit } from "@/lib/credentials/types";

function auditData(audit: NewAudit, credentialId: string, credentialLabel: string) {
  return {
    organizationId: audit.organizationId,
    credentialId: audit.credentialId || credentialId,
    credentialLabel: audit.credentialLabel || credentialLabel,
    actorUserId: audit.actorUserId,
    kind: audit.kind,
    purpose: audit.purpose,
    success: audit.success,
  };
}

export function prismaCredentialRepo(): CredentialRepo {
  return {
    async insert(data, audit) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.clientCredential.create({ data });
        await tx.credentialAuditEvent.create({
          data: auditData(audit, row.id, row.label),
        });
        return row;
      });
    },
    async list(organizationId) {
      return prisma.clientCredential.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      });
    },
    async find(organizationId, id) {
      return prisma.clientCredential.findFirst({ where: { id, organizationId } });
    },
    async remove(organizationId, id, audit) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.clientCredential.findFirst({ where: { id, organizationId } });
        if (!row) return false;
        await tx.clientCredential.delete({ where: { id: row.id } });
        await tx.credentialAuditEvent.create({ data: auditData(audit, row.id, row.label) });
        return true;
      });
    },
    async markUsed(organizationId, id, when, audit) {
      await prisma.$transaction(async (tx) => {
        await tx.clientCredential.updateMany({
          where: { id, organizationId },
          data: { lastUsedAt: when },
        });
        await tx.credentialAuditEvent.create({ data: auditData(audit, id, audit.credentialLabel) });
      });
    },
    async addAudit(audit) {
      return prisma.credentialAuditEvent.create({ data: auditData(audit, audit.credentialId, audit.credentialLabel) });
    },
    async listAudit(organizationId, limit) {
      return prisma.credentialAuditEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },
    async addConfirmation(data) {
      return prisma.credentialConfirmation.create({ data });
    },
    async consumeConfirmation(input) {
      const row = await prisma.credentialConfirmation.findFirst({
        where: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: input.action,
          usedAt: null,
          expiresAt: { gt: input.now },
        },
        orderBy: { expiresAt: "asc" },
      });
      if (!row) return null;
      const updated = await prisma.credentialConfirmation.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: input.now },
      });
      if (updated.count !== 1) return null;
      return { ...row, usedAt: input.now };
    },
    async addGrant(data) {
      return prisma.credentialFillGrant.create({ data });
    },
    async findGrant(tokenHash) {
      return prisma.credentialFillGrant.findUnique({ where: { tokenHash } });
    },
    async consumeGrant(tokenHash, now) {
      const updated = await prisma.credentialFillGrant.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (updated.count !== 1) return null;
      const row = await prisma.credentialFillGrant.findUnique({ where: { tokenHash } });
      return row ?? null;
    },
  };
}
