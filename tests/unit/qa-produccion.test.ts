import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { spanishFieldMessage } from "@/lib/spanish-validity";

describe("favicon y menú móvil", () => {
  test("/favicon.ico es un icono azul real", () => {
    const bytes = readFileSync(new URL("../../src/app/favicon.ico", import.meta.url));
    expect(bytes.subarray(0, 4).toString("hex")).toBe("00000100");
    expect(bytes.length).toBeGreaterThan(100);
  });

  test("en el celular el menú del panel cabe en una línea con desplazamiento", () => {
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    const start = css.indexOf("@media (max-width: 980px)");
    const end = css.indexOf("@media (max-width: 720px)");
    const nav = css.slice(start, end);
    const menu = nav.slice(nav.indexOf(".panel-nav {"), nav.indexOf(".side-foot"));
    expect(menu).toContain("flex-wrap: nowrap");
    expect(menu).toContain("overflow-x: auto");
    expect(menu).not.toContain("flex-wrap: wrap");
  });
});

describe("validación en español", () => {
  test("el campo vacío, el correo y la clave corta no usan el texto del navegador", () => {
    expect(spanishFieldMessage({ valueMissing: true, typeMismatch: false, tooShort: false, tooLong: false })).toBe("Completa este campo.");
    expect(spanishFieldMessage({ valueMissing: true, typeMismatch: false, tooShort: false, tooLong: false, type: "checkbox" })).toBe(
      "Marca esta casilla para continuar.",
    );
    expect(spanishFieldMessage({ valueMissing: false, typeMismatch: true, tooShort: false, tooLong: false, type: "email" })).toBe(
      "Escribe un correo válido.",
    );
    expect(spanishFieldMessage({ valueMissing: false, typeMismatch: false, tooShort: true, tooLong: false, minLength: 8 })).toBe(
      "Usa al menos 8 caracteres.",
    );
    expect(spanishFieldMessage({ valueMissing: true, typeMismatch: false, tooShort: false, tooLong: false })).not.toContain("Please fill out");
  });
});
