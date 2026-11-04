import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { GOOGLE_STATE_COOKIE, googleClient, googleRedirectUri } from "@/lib/google-auth";
import { logEvent } from "@/lib/log";
import { safePanelPath } from "@/lib/paths";
import { prisma } from "@/lib/prisma";
import { writeSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function fail(code: string) {
  return NextResponse.redirect(`${appUrl()}/ingresar?error=${code}`);
}

export async function GET(request: Request) {
  const client = googleClient();
  if (!client) return fail("google_no_configurado");
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const saved = jar.get(GOOGLE_STATE_COOKIE)?.value ?? "";
  jar.delete(GOOGLE_STATE_COOKIE);
  const [state, next = "/panel"] = saved.split("|");
  const code = params.get("code");
  if (!state || state !== params.get("state") || !code) return fail("google");

  let email = "";
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!tokenRes.ok || !token.access_token) return fail("google");
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
    if (!infoRes.ok || !info.email || info.email_verified !== true) return fail("google");
    email = info.email.trim().toLowerCase();
  } catch {
    logEvent("auth.google", { status: 502 });
    return fail("google");
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) return fail("google_sin_cuenta");
  if (!user.emailVerifiedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  await writeSession({
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role,
    authVersion: user.authVersion,
  });
  return NextResponse.redirect(`${appUrl()}${safePanelPath(next)}`);
}
