export const CREDENTIAL_LIMIT = 50;
export const GRANT_TTL_MS = 2 * 60 * 1000;
export const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

export type RiskAction = "DECLARAR" | "PAGAR";

export type AuditKind = "CREATE" | "DELETE" | "USE" | "CONFIRM";

export type StoredCredential = {
  id: string;
  organizationId: string;
  label: string;
  portal: string;
  usernameHint: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  consentAcceptedAt: Date;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
};

export type PublicCredential = {
  id: string;
  label: string;
  portal: string;
  usernameHint: string;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
};

export type AuditEvent = {
  id: string;
  organizationId: string;
  credentialId: string;
  credentialLabel: string;
  actorUserId: string;
  kind: AuditKind;
  purpose: string;
  success: boolean;
  createdAt: Date;
};

export type NewAudit = Omit<AuditEvent, "id" | "createdAt">;

export type Confirmation = {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: RiskAction;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type FillGrant = {
  id: string;
  organizationId: string;
  actorUserId: string;
  tokenHash: string;
  allowedCredentialIds: string[];
  purpose: string;
  highRisk: boolean;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type CredentialRepo = {
  insert(data: Omit<StoredCredential, "id" | "createdAt" | "updatedAt" | "lastUsedAt">, audit: NewAudit): Promise<StoredCredential>;
  list(organizationId: string): Promise<StoredCredential[]>;
  find(organizationId: string, id: string): Promise<StoredCredential | null>;
  remove(organizationId: string, id: string, audit: NewAudit): Promise<boolean>;
  markUsed(organizationId: string, id: string, when: Date, audit: NewAudit): Promise<void>;
  addAudit(audit: NewAudit): Promise<AuditEvent>;
  listAudit(organizationId: string, limit: number): Promise<AuditEvent[]>;
  addConfirmation(data: Omit<Confirmation, "id" | "usedAt" | "createdAt">): Promise<Confirmation>;
  consumeConfirmation(input: {
    organizationId: string;
    actorUserId: string;
    action: RiskAction;
    now: Date;
  }): Promise<Confirmation | null>;
  addGrant(data: Omit<FillGrant, "id" | "usedAt" | "createdAt">): Promise<FillGrant>;
  findGrant(tokenHash: string): Promise<FillGrant | null>;
  consumeGrant(tokenHash: string, now: Date): Promise<FillGrant | null>;
};

export type CredentialMeta = {
  id: string;
  label: string;
  portal: string;
  usernameHint: string;
};

export const PUBLIC_CREDENTIAL_KEYS = ["id", "label", "portal", "usernameHint", "createdAt", "updatedAt", "lastUsedAt"] as const;

export function toPublicCredential(row: StoredCredential): PublicCredential {
  return {
    id: row.id,
    label: row.label,
    portal: row.portal,
    usernameHint: row.usernameHint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function publicCredentialJson(row: PublicCredential) {
  return {
    id: row.id,
    label: row.label,
    portal: row.portal,
    usernameHint: row.usernameHint,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export function publicAuditJson(row: AuditEvent) {
  return {
    id: row.id,
    credentialId: row.credentialId,
    credentialLabel: row.credentialLabel,
    actorUserId: row.actorUserId,
    kind: row.kind,
    purpose: row.purpose,
    success: row.success,
    createdAt: row.createdAt.toISOString(),
  };
}

export function usernameHintFrom(username: string) {
  const clean = username.trim();
  if (clean.length >= 4) return clean.slice(-4);
  return "••••";
}
