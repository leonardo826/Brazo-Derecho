import { SignJWT, jwtVerify } from "jose";
import type { MemberRole } from "@prisma/client";

export type Session = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: MemberRole;
  authVersion: number;
};

function secretKey() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET debe tener al menos 32 caracteres");
  }
  return new TextEncoder().encode(value);
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.email === "string" &&
    typeof record.name === "string" &&
    typeof record.organizationId === "string" &&
    typeof record.organizationName === "string" &&
    (record.role === "OWNER" || record.role === "STAFF") &&
    typeof record.authVersion === "number" &&
    Number.isInteger(record.authVersion)
  );
}

export async function createSessionToken(session: Session) {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!isSession(payload)) return null;
    return {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      organizationId: payload.organizationId,
      organizationName: payload.organizationName,
      role: payload.role,
      authVersion: payload.authVersion,
    };
  } catch {
    return null;
  }
}
