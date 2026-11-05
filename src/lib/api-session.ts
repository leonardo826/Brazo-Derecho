import { CSRF_COOKIE, CSRF_HEADER, sameOrigin, tokensMatch } from "@/lib/csrf-token";
import { resolveSession, type Session } from "@/lib/session";

export async function requireApiSession(request: Request): Promise<Session | Response> {
  const session = await resolveSession();
  if (!session) return Response.json({ error: "sesion" }, { status: 401 });
  if (request.method === "GET" || request.method === "HEAD") return session;
  const header = request.headers.get(CSRF_HEADER) ?? "";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (sameOrigin(request.headers.get("origin"), host)) return session;
  const { cookies } = await import("next/headers");
  const cookie = (await cookies()).get(CSRF_COOKIE)?.value ?? "";
  if (!tokensMatch(cookie, header)) return Response.json({ error: "csrf" }, { status: 403 });
  return session;
}
