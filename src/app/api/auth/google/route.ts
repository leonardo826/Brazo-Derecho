import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { GOOGLE_STATE_COOKIE, googleClient, googleRedirectUri } from "@/lib/google-auth";
import { safePanelPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const client = googleClient();
  if (!client) return NextResponse.redirect(`${appUrl()}/ingresar?error=google_no_configurado`);
  const next = safePanelPath(new URL(request.url).searchParams.get("siguiente") ?? "");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client.id);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  const response = NextResponse.redirect(url.toString());
  response.cookies.set(GOOGLE_STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return response;
}
