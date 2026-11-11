import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("textos del 404", () => {
  test("la página general no habla de cotizaciones y la del cotizador sí", () => {
    const general = readFileSync(path.join(process.cwd(), "src/app/not-found.tsx"), "utf8");
    const quote = readFileSync(path.join(process.cwd(), "src/app/panel/cotizador/[id]/not-found.tsx"), "utf8");
    expect(general).toContain("Esta página no existe.");
    expect(general).toContain('href="/panel"');
    expect(general).not.toContain("cotización");
    expect(quote).toContain("El enlace no existe o la cotización no es de tu empresa.");
  });
});
