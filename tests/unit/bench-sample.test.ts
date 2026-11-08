import { describe, expect, test } from "vitest";
import { classifyTurn } from "../../scripts/bench-sample.mjs";

const completo = {
  click: 1000,
  ackHttp: 1016,
  sseByte: 1017,
  domUtil: 1023,
  domEstado: 1003,
  sseMessage: 1025,
  sseDone: 1028,
  messageId: "msg-1",
  domId: 1027,
};

describe("una muestra del banco", () => {
  test("el id guardado cierra la muestra", () => {
    const row = classifyTurn(completo);
    expect(row.completo).toBe(true);
    expect(row.domListo).toBe(true);
    expect(row.ackHttp).toBeLessThanOrEqual(row.sseByte ?? 0);
    expect(row.domCambio).toBeGreaterThanOrEqual(row.sseByte ?? 0);
  });

  test("el cambio de DOM sin id no es un éxito completo", () => {
    const row = classifyTurn({ ...completo, messageId: null, domId: null, sseMessage: null });
    expect(row.domListo).toBe(true);
    expect(row.completo).toBe(false);
    expect(row.motivo).toBe("sin-id-persistido");
  });

  test("un texto anterior al primer byte no cuenta", () => {
    const row = classifyTurn({ ...completo, domUtil: 1005 });
    expect(row.domListo).toBe(false);
    expect(row.completo).toBe(false);
  });
});
