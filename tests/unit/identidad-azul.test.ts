import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function block(selector: string) {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, start + 280);
}

describe("identidad azul con tokens ya definidos", () => {
  test("el botón principal y la barra del panel dejan el cobre y el verde", () => {
    expect(block(".button, .button-link {")).toContain("background: var(--action)");
    expect(block(".panel-side {")).toContain("background: var(--navy)");
    expect(block(".mark {")).toContain("background: var(--action)");
  });

  test("el aviso, el éxito y la confirmación sensible no pasan a azul", () => {
    expect(css).toContain(".banner.ok { background: var(--good-bg); color: var(--good); }");
    expect(css).toContain(".bar.warn > span { background: var(--copper); }");
    expect(css).toContain(".confirm-card {\n  border: 1px solid var(--copper);");
    expect(css).toContain(".composer-icon.recording { color: var(--copper); background: var(--bad-bg); }");
  });

  test("el foco visible usa el azul de acción y no se recorta el desplazamiento", () => {
    expect(css).toContain(":focus-visible { outline: 2px solid var(--action); outline-offset: 2px; }");
  });

  test("catálogo y precios usan la marca IA Bot y el azul de la portada", () => {
    const layout = readFileSync(new URL("../../src/app/(public)/layout.tsx", import.meta.url), "utf8");
    const header = readFileSync(new URL("../../src/components/site-header.tsx", import.meta.url), "utf8");
    const footer = readFileSync(new URL("../../src/components/site-footer.tsx", import.meta.url), "utf8");
    const logo = readFileSync(new URL("../../src/components/logo.tsx", import.meta.url), "utf8");
    const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
    expect(layout).toContain('className="iabot"');
    expect(header).toContain("IA Bot");
    expect(header).toContain("iabot-logo");
    expect(footer).toContain("iabot-footer");
    expect(css).toContain(".iabot h3");
    expect(css).toContain(".iabot .price");
    expect(logo).toContain("<em>Brazo</em> Derecho");
    expect(config).toContain('source: "/panel"');
    expect(config).toContain('value: "no-store"');
  });
});
