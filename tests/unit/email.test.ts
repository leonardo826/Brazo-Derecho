import { afterEach, describe, expect, test, vi } from "vitest";
import { RESET_TTL_MS, VERIFY_TTL_MS, createAuthTokenValue, hashAuthToken } from "@/lib/auth-token";
import { deliverEmail, emailFromAddress, emailIsMock } from "@/lib/email/deliver";
import { passwordResetEmail, verificationEmail } from "@/lib/email/templates";
import { AGENT_CATALOG } from "@/lib/catalog";
import { priceWithIva } from "@/lib/flow/plans";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("correo transaccional", () => {
  test("sin clave no llama a la red y deja el texto en el log", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const delivery = await deliverEmail(
      {
        to: "ana@ejemplo.cl",
        subject: "Confirma tu correo en Brazo Derecho",
        text: "enlace http://localhost:3000/verificar?token=abc",
        html: "<p>enlace</p>",
        kind: "verificacion",
      },
      fetchImpl,
    );
    expect(emailIsMock()).toBe(true);
    expect(delivery).toEqual({ provider: "mock", status: "simulado", error: "" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.mock.calls.some((call) => String(call[0]).includes("email.mock") && String(call[0]).includes("abc"))).toBe(
      true,
    );
  });

  test("con clave llama a Resend y no guarda el fallo como éxito", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "Brazo Derecho <avisos@brazo.cl>");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("ok", { status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const message = {
      to: "ana@ejemplo.cl",
      subject: "Recupera tu contraseña de Brazo Derecho",
      text: "hola",
      html: "<p>hola</p>",
      kind: "recuperacion" as const,
    };
    const sent = await deliverEmail(message, fetchImpl);
    expect(sent.status).toBe("enviado");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    const body = JSON.parse(String(init?.body));
    expect(body.from).toBe("Brazo Derecho <avisos@brazo.cl>");
    expect(body.to).toEqual(["ana@ejemplo.cl"]);
    expect(body.subject).toBe(message.subject);
    expect(emailFromAddress()).toBe("Brazo Derecho <avisos@brazo.cl>");

    const failed = await deliverEmail(
      message,
      vi.fn<typeof fetch>(async () => new Response("no", { status: 422 })),
    );
    expect(failed).toMatchObject({ provider: "resend", status: "fallido" });
  });

  test("el enlace va en el texto y el nombre se escapa en el html", () => {
    const url = "http://localhost:3000/verificar?token=uno";
    const verification = verificationEmail({ name: "Ana <script>", url });
    expect(verification.subject).toContain("Confirma tu correo");
    expect(verification.text).toContain(url);
    expect(verification.html).toContain("&lt;script&gt;");
    expect(verification.html).not.toContain("<script>");
    const reset = passwordResetEmail({ name: "Ana", url: "http://localhost:3000/recuperar/nueva?token=dos" });
    expect(reset.text).toContain("una sola vez");
    expect(reset.text).toContain("token=dos");
  });
});

describe("tokens de un uso", () => {
  test("el hash no es el token y la vigencia queda fija", () => {
    const raw = createAuthTokenValue();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw.length).toBeGreaterThanOrEqual(40);
    expect(hashAuthToken(raw)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAuthToken(raw)).not.toBe(raw);
    expect(hashAuthToken(raw)).toBe(hashAuthToken(raw));
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(VERIFY_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });
});

describe("precios publicados", () => {
  test("los tres planes quedan netos y con IVA", () => {
    expect(AGENT_CATALOG.WHATSAPP.priceClp).toBe(39990);
    expect(AGENT_CATALOG.QUOTES.priceClp).toBe(49990);
    expect(AGENT_CATALOG.MARKETING.priceClp).toBe(34990);
    expect(priceWithIva(39990)).toBe(47588);
    expect(priceWithIva(49990)).toBe(59488);
    expect(priceWithIva(34990)).toBe(41638);
  });
});
