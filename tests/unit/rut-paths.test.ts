import { describe, expect, test } from "vitest";
import { passwordError } from "@/lib/password";
import { safePanelPath } from "@/lib/paths";
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
