import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PublicCatalog } from "@/components/public-catalog";
import { formatClp } from "@/lib/format";
import { IABOT_PRICE_CLP } from "@/lib/subscription";

const PUBLISHED = formatClp(IABOT_PRICE_CLP);

describe("precio visible del Contador", () => {
  test("la vitrina muestra el mismo bruto con IVA que la portada y el pago", () => {
    const html = renderToStaticMarkup(createElement(PublicCatalog, { emphasis: "agentes" }));
    const card = html.slice(html.indexOf("Contador Auditor Chile"));
    expect(IABOT_PRICE_CLP).toBe(63546);
    expect(card.startsWith("Contador Auditor Chile")).toBe(true);
    expect(card).toContain(PUBLISHED);
    expect(card).toContain("IVA incluido");
    expect(html).not.toContain("$53.538");
    expect(html).not.toContain("$44.990");
    expect(html).not.toContain("neto al mes");
  });

  test("el panel y el alta no vuelven a anunciar un neto distinto", () => {
    const panel = readFileSync(new URL("../../src/app/panel/page.tsx", import.meta.url), "utf8");
    const empezar = readFileSync(new URL("../../src/app/panel/empezar/page.tsx", import.meta.url), "utf8");
    const pago = readFileSync(new URL("../../src/app/panel/pago/page.tsx", import.meta.url), "utf8");
    for (const source of [panel, empezar, pago]) {
      expect(source).toContain("iabotChargeClp()");
      expect(source).not.toContain("neto al mes");
    }
  });
});
