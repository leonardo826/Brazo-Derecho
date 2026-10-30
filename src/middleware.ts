import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/cookie";
import { CSRF_COOKIE, CSRF_HEADER, validCsrfToken } from "@/lib/csrf-token";

function csrfToken(request: NextRequest) {
  const existing = request.cookies.get(CSRF_COOKIE)?.value ?? "";
  if (validCsrfToken(existing)) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function applyCsrf(response: NextResponse, request: NextRequest, token: string) {
  const destination = request.headers.get("sec-fetch-dest");
  const document = destination === "document" || destination === null;
  if (document && request.cookies.get(CSRF_COOKIE)?.value !== token) {
    response.cookies.set(CSRF_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return response;
}

export function middleware(request: NextRequest) {
  if (request.headers.has("next-action")) {
    return NextResponse.next();
  }

  const token = csrfToken(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSRF_HEADER, token);

  const panel = request.nextUrl.pathname.startsWith("/panel");
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (panel && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/ingresar";
    url.search = "";
    url.searchParams.set("siguiente", request.nextUrl.pathname);
    return applyCsrf(NextResponse.redirect(url), request, token);
  }

  return applyCsrf(NextResponse.next({ request: { headers: requestHeaders } }), request, token);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
