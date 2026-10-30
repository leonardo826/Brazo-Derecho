import { afterEach, describe, expect, test, vi } from "vitest";
import { sameOrigin, tokensMatch, validCsrfToken } from "@/lib/csrf-token";
import { consumeRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { captureException, parseSentryDsn } from "@/lib/sentry";

afterEach(() => {
  resetRateLimits();
  vi.unstubAllEnvs();
});

describe("origen y CSRF", () => {
  test("acepta el mismo host y rechaza otro origen", () => {
    expect(sameOrigin("http://127.0.0.1:3100", "127.0.0.1:3100")).toBe(true);
    expect(sameOrigin("https://brazo.cl", "brazo.cl")).toBe(true);
    expect(sameOrigin("https://evil.test", "brazo.cl")).toBe(false);
    expect(sameOrigin(null, "brazo.cl")).toBe(false);
    expect(sameOrigin("no-es-url", "brazo.cl")).toBe(false);
  });

  test("compara el token del formulario con el de la cookie", () => {
    const token = "a".repeat(32);
    expect(validCsrfToken(token)).toBe(true);
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, "b".repeat(32))).toBe(false);
    expect(tokensMatch("corto", token)).toBe(false);
  });
});

describe("límite de intentos", () => {
  test("corta cuando se pasa el cupo y vuelve a abrir al terminar la ventana", () => {
    const start = 1_000_000;
    expect(consumeRateLimit("login:1", 2, 1_000, start).ok).toBe(true);
    expect(consumeRateLimit("login:1", 2, 1_000, start + 10).ok).toBe(true);
    expect(consumeRateLimit("login:1", 2, 1_000, start + 20).ok).toBe(false);
    expect(consumeRateLimit("login:otro", 2, 1_000, start + 20).ok).toBe(true);
    expect(consumeRateLimit("login:1", 2, 1_000, start + 1_000).ok).toBe(true);
  });
});

describe("cabeceras", () => {
  test("incluye las protecciones y HSTS solo en producción", () => {
    const dev = securityHeaders("development").map((header) => header.key);
    const prod = securityHeaders("production");
    expect(dev).toContain("Content-Security-Policy");
    expect(dev).toContain("X-Content-Type-Options");
    expect(dev).toContain("X-Frame-Options");
    expect(dev).not.toContain("Strict-Transport-Security");
    expect(prod.some((header) => header.key === "Strict-Transport-Security")).toBe(true);
    expect(contentSecurityPolicy("production")).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy("production")).toContain("form-action 'self'");
    expect(contentSecurityPolicy("development")).toContain("'unsafe-eval'");
  });
});

describe("Sentry opcional", () => {
  test("sin DSN no llama a la red", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await captureException(new Error("falló el webhook"), { source: "test" }, fetchImpl);
    expect(result.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("con DSN arma el envío y no lo hace si el DSN es inválido", async () => {
    expect(parseSentryDsn("https://llave@o123.ingest.sentry.io/99")?.storeUrl).toContain("/api/99/store/");
    expect(parseSentryDsn("no-es-un-dsn")).toBeNull();

    vi.stubEnv("SENTRY_DSN", "https://llave@o123.ingest.sentry.io/99");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("ok"));
    const result = await captureException(new Error("falló"), { source: "flow.webhook" }, fetchImpl);
    expect(result.sent).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url.startsWith("https://o123.ingest.sentry.io/api/99/store/")).toBe(true);
    expect(url).toContain("sentry_key=llave");
  });
});
