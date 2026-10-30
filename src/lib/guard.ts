import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { csrfMatches } from "@/lib/csrf";
import { sameOrigin } from "@/lib/csrf-token";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

export function withError(path: string, code: string) {
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}error=${code}`;
}

export async function clientAddress() {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "local";
  return ip.slice(0, 80);
}

export async function guardMutation(formData: FormData, failurePath: string) {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (!sameOrigin(origin, host) || !(await csrfMatches(formData))) {
    redirect(withError(failurePath, "csrf"));
  }
}

export function guardRate(key: string, limit: number, windowMs: number, failurePath: string) {
  if (!consumeRateLimit(key, limit, windowMs).ok) {
    redirect(withError(failurePath, "ritmo"));
  }
}

export async function assertOwnOrganizationActive(organizationId: string, failurePath: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true },
  });
  if (organization?.suspendedAt) redirect(withError(failurePath, "suspendida"));
}
