import { describe, expect, test } from "vitest";
import { buildQuoteLines, matchFreeText, quoteTotal, type CatalogItem } from "@/lib/agents/quotes";

const catalog: CatalogItem[] = [
  { id: "pin", sku: "PIN-1G", name: "Pintura látex blanco 1 galón", unit: "galón", priceClp: 18990, active: true },
  { id: "neg", sku: "PIN-NEG", name: "Pintura látex negro 1 galón", unit: "galón", priceClp: 19990, active: true },
  { id: "tal", sku: "TAL-650", name: "Taladro percutor 650 W", unit: "unidad", priceClp: 59990, active: true },
  { id: "off", sku: "CAN-40", name: "Candado 40 mm", unit: "unidad", priceClp: 4590, active: false },
];

describe("cotizador", () => {
  test("el precio sale de la lista aunque alguien intente pasar otro", () => {
    const built = buildQuoteLines([{ priceItemId: "pin", quantity: 2 }], catalog);
    expect(built.rejected).toBe(0);
    expect(built.lines).toEqual([
      {
        priceItemId: "pin",
        description: "Pintura látex blanco 1 galón",
        unit: "galón",
        quantity: 2,
        unitPriceClp: 18990,
      },
    ]);
    expect(quoteTotal(built.lines)).toBe(37980);
  });

  test("un id de otra empresa o un producto pausado no entra", () => {
    const built = buildQuoteLines(
      [
        { priceItemId: "de-otra-empresa", quantity: 1 },
        { priceItemId: "off", quantity: 4 },
      ],
      catalog,
    );
    expect(built.lines).toHaveLength(0);
    expect(built.rejected).toBe(2);
  });

  test("el pedido en texto reconoce cantidad y no confunde el color", () => {
    const matches = matchFreeText("2 galones de pintura látex blanco y 1 taladro percutor", catalog);
    const built = buildQuoteLines(matches, catalog);
    const byId = new Map(built.lines.map((line) => [line.priceItemId, line]));
    expect(byId.get("pin")?.quantity).toBe(2);
    expect(byId.get("pin")?.unitPriceClp).toBe(18990);
    expect(byId.get("tal")?.quantity).toBe(1);
    expect(byId.get("tal")?.unitPriceClp).toBe(59990);
    expect(byId.has("neg")).toBe(false);
  });

  test("una palabra suelta no alcanza para inventar un producto", () => {
    expect(matchFreeText("pintura", catalog)).toHaveLength(0);
  });
});
