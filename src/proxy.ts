import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { computerFeatureEnabled } from "@/lib/computer/flag";
import { SESSION_COOKIE } from "@/lib/cookie";
import { CSRF_COOKIE, CSRF_HEADER, validCsrfToken } from "@/lib/csrf-token";

const CLOSED = `<!doctype html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No está esta página</title>
<style>
  body { margin: 0; background: #f7f4ee; color: #1c1915; font-family: system-ui, sans-serif; }
  main { max-width: 28rem; margin: 2rem auto; padding: 1.25rem; }
  h1 { font-size: 1.8rem; line-height: 1.2; }
  a { color: #0b3a6e; }
</style>
</head>
<body>
<main>
<p>404</p>
<h1>No está esta página</h1>
<p>Esta página no existe.</p>
<p><a href="/panel">Ir al panel</a></p>
</main>
</body>
</html>`;

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

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if ((path === "/panel/computador" || path.startsWith("/panel/computador/")) && !computerFeatureEnabled()) {
    return new NextResponse(CLOSED, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (request.headers.has("next-action")) {
    return NextResponse.next();
  }

  const token = csrfToken(request);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSRF_HEADER, token);
  requestHeaders.set("x-pathname", path);

  const panel = path.startsWith("/panel");
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (panel && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/ingresar";
    url.search = "";
    url.searchParams.set("siguiente", path);
    return applyCsrf(NextResponse.redirect(url), request, token);
  }

  return applyCsrf(NextResponse.next({ request: { headers: requestHeaders } }), request, token);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
