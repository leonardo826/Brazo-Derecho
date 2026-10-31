const BASE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
] as const;

// Next.js 16 no usa eval en producción ni en `next start`. La guía de CSP
// pide 'unsafe-eval' solo en `next dev`, porque React reconstruye ahí el stack
// del servidor. Cualquier otro entorno (build, Vercel, pruebas) queda sin eso.
export function contentSecurityPolicy(nodeEnv: string | undefined = process.env.NODE_ENV) {
  const script =
    nodeEnv === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function securityHeaders(nodeEnv: string | undefined = process.env.NODE_ENV) {
  const headers: { key: string; value: string }[] = [
    ...BASE_HEADERS,
    { key: "Content-Security-Policy", value: contentSecurityPolicy(nodeEnv) },
  ];
  if (nodeEnv === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }
  return headers;
}
