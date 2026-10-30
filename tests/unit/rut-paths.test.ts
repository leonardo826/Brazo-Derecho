import { describe, expect, test } from "vitest";
import { passwordError } from "@/lib/password";
import { panelReturnPath, paymentReturnPath, safePanelPath } from "@/lib/paths";
import { formatRut, isValidRut } from "@/lib/rut";
import { slugify } from "@/lib/slug";

describe("RUT", () => {
  test("acepta RUT chilenos con dígito verificador", () => {
    expect(isValidRut("76.123.456-0")).toBe(true);
    expect(isValidRut("76543210-3")).toBe(true);
    expect(formatRut("761234560")).toBe("76.123.456-0");
  });

  test("rechaza un dígito malo", () => {
    expect(isValidRut("76.123.456-1")).toBe(false);
    expect(isValidRut("no-es-rut")).toBe(false);
  });
});

describe("rutas internas", () => {
  test("solo deja volver al panel", () => {
    expect(safePanelPath("/panel/cotizador")).toBe("/panel/cotizador");
    expect(safePanelPath("https://evil.test")).toBe("/panel");
    expect(safePanelPath("//evil.test")).toBe("/panel");
    expect(safePanelPath("/panel/../cuenta")).toBe("/panel");
    expect(safePanelPath("/ingresar")).toBe("/panel");
    expect(paymentReturnPath("/panel/whatsapp")).toBe("/panel/whatsapp");
    expect(paymentReturnPath("/panel/pago")).toBe("/panel");
    expect(paymentReturnPath("https://evil.test/panel")).toBe("/panel");
  });

  test("al reenviar el correo vuelve al paso del asistente", () => {
    expect(panelReturnPath("http://127.0.0.1:3100/panel/empezar?paso=agente")).toBe("/panel/empezar?paso=agente");
    expect(panelReturnPath("http://127.0.0.1:3100/panel/empezar?paso=probar&agente=WHATSAPP")).toBe(
      "/panel/empezar?paso=probar&agente=WHATSAPP",
    );
    expect(panelReturnPath("http://127.0.0.1:3100/panel/cotizador?ok=precio")).toBe("/panel/cotizador");
    expect(panelReturnPath("http://evil.test/panel/cuenta")).toBe("/panel/cuenta");
    expect(panelReturnPath("no-es-url")).toBe("/panel");
    expect(panelReturnPath(null)).toBe("/panel");
  });
});

describe("otras reglas de cuenta", () => {
  test("la contraseña pide letra y número", () => {
    expect(passwordError("corta1")).toMatch(/8/);
    expect(passwordError("sololetras")).toMatch(/número/);
    expect(passwordError("Clave-demo-2026")).toBeNull();
  });

  test("el slug quita tildes", () => {
    expect(slugify("Ferretería Los Aromos")).toBe("ferreteria-los-aromos");
  });
});
