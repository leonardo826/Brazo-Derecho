import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSession } from "@/lib/session";

export function vaultJson(status: number, body: unknown) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function vaultStatus(error: string) {
  switch (error) {
    case "sesion":
    case "token":
    case "no_autorizado":
      return 401;
    case "no_pedido":
    case "suspendida":
      return 403;
    case "noencontrado":
      return 404;
    case "boveda_confirmacion":
      return 409;
    case "ritmo":
      return 429;
    case "boveda_sin_clave":
    case "boveda_sin_token":
    case "boveda_migracion":
      return 503;
    default:
      return 400;
  }
}

export function vaultFailure(error: string) {
  return vaultJson(vaultStatus(error), { ok: false, error });
}

export async function requireVaultSession() {
  const session = await resolveSession();
  if (!session) return { ok: false as const, response: vaultFailure("sesion") };
  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { suspendedAt: true },
  });
  if (organization?.suspendedAt) return { ok: false as const, response: vaultFailure("suspendida") };
  return { ok: true as const, session };
}

export function vaultRate(key: string, limit: number) {
  if (!consumeRateLimit(key, limit, 60_000).ok) return vaultFailure("ritmo");
  return null;
}

export function missingVaultTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

export function vaultErrorResponse(error: unknown): Response {
  if (missingVaultTable(error)) return vaultFailure("boveda_migracion");
  throw error;
}

export function bearerToken(request: Request) {
  const raw = request.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice("Bearer ".length).trim() : "";
}

export function agentTokenMatches(got: string, expected: string) {
  if (!expected || !got) return false;
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function readJson(request: Request) {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
