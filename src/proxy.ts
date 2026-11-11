import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { computerFeatureEnabled } from "@/lib/computer/flag";

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
<p>El enlace no existe o la cotización no es de tu empresa.</p>
<p><a href="/">Volver al inicio</a></p>
</main>
</body>
</html>`;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if ((path === "/panel/computador" || path.startsWith("/panel/computador/")) && !computerFeatureEnabled()) {
    return new NextResponse(CLOSED, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/computador", "/panel/computador/:path*"],
};
