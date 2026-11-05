import { describe, expect, test } from "vitest";
import {
  applyMeterEvent,
  buildMonthBill,
  EMPTY_USAGE_MONTH,
  estimateClientPriceClp,
  fixedShelfPriceClp,
  sanitizeTokens,
  splitMeterBuckets,
} from "@/lib/billing";

const empty = { ...EMPTY_USAGE_MONTH };

describe("medición de consumo", () => {
  test("una tarea suma 1 y los tokens; un chat o un paso de computador no suman tareas", () => {
    const afterChat = applyMeterEvent(empty, {
      kind: "CHAT",
      inputTokens: 1000,
      cachedTokens: 200,
      outputTokens: 40,
    });
    const afterStep = applyMeterEvent(afterChat, {
      kind: "COMPUTER_STEP",
      inputTokens: 10,
      cachedTokens: 0,
      outputTokens: 5,
    });
    const afterTask = applyMeterEvent(afterStep, { kind: "TASK" });
    expect(afterTask).toEqual({
      tasksCount: 1,
      inputTokens: 1010,
      cachedTokens: 200,
      outputTokens: 45,
    });
  });

  test("los tokens en caché no pueden pasar a los de entrada y los negativos se van a cero", () => {
    expect(sanitizeTokens({ inputTokens: 10, cachedTokens: 40, outputTokens: -3 })).toEqual({
      inputTokens: 10,
      cachedTokens: 10,
      outputTokens: 0,
    });
  });

  test("dos empresas no comparten el acumulado", () => {
    const ferreteria = applyMeterEvent(empty, { kind: "TASK", inputTokens: 8, outputTokens: 2 });
    const cafe = applyMeterEvent(empty, { kind: "CHAT", inputTokens: 3, outputTokens: 1 });
    expect(ferreteria.tasksCount).toBe(1);
    expect(ferreteria.inputTokens).toBe(8);
    expect(cafe.tasksCount).toBe(0);
    expect(cafe.outputTokens).toBe(1);
  });

  test("el precio al cliente es el doble del costo real y no usa un precio por tarea", () => {
    const tokens = { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 };
    const byModel = [{ model: "grok-4.3", tokens }];
    const withTasks = estimateClientPriceClp({
      tasks: 40,
      tokens,
      fx: 900,
      computerUsd: 1,
      byModel,
      env: {},
    });
    const withoutTasks = estimateClientPriceClp({
      tasks: 0,
      tokens,
      fx: 900,
      computerUsd: 1,
      byModel,
      env: {},
    });
    expect(withTasks.xaiUsd).toBeCloseTo(1.25);
    expect(withTasks.realUsd).toBeCloseTo(2.25);
    expect(withTasks.clientUsd).toBeCloseTo(4.5);
    expect(withTasks.clientClp).toBe(4050);
    expect(withoutTasks.clientClp).toBe(withTasks.clientClp);
  });

  test("la tarifa de entorno pisa la constante y el precio fijo no entra en el estimado", () => {
    const tokens = { inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 0 };
    const price = estimateClientPriceClp({
      tasks: 1,
      tokens,
      fx: 900,
      computerUsd: 0,
      env: { USAGE_USD_PER_M_INPUT: "4", USAGE_USD_PER_M_CACHED: "1" },
    });
    expect(price.xaiUsd).toBeCloseTo(3.4);
    expect(price.clientClp).toBe(Math.round(6.8 * 900));
    expect(fixedShelfPriceClp({ IABOT_PRICE_CLP: "53400" })).toBe(53400);
    expect(fixedShelfPriceClp({})).toBeNull();
  });

  test("el mes separa los tokens del simulador y no los cobra", () => {
    const bill = buildMonthBill({
      yearMonth: "2026-11",
      label: "noviembre de 2026",
      month: { tasksCount: 2, inputTokens: 1_000_100, cachedTokens: 0, outputTokens: 20 },
      buckets: [
        { model: "grok-4.7", synthetic: false, kind: "CHAT", inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 },
        { model: "grok-4.3", synthetic: true, kind: "CHAT", inputTokens: 100, cachedTokens: 0, outputTokens: 20 },
        { model: "grok-4.7", synthetic: true, kind: "TASK", inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
      ],
      env: { IABOT_PRICE_CLP: "53400", USAGE_COMPUTER_USD: "0.5", USAGE_FX_CLP_PER_USD: "900" },
    });
    expect(bill.tasks).toBe(2);
    expect(bill.apiTokens.inputTokens).toBe(1_000_000);
    expect(bill.simulatorTokens).toEqual({ inputTokens: 100, cachedTokens: 0, outputTokens: 20 });
    expect(bill.fixedPriceClp).toBe(53400);
    expect(bill.xaiUsd).toBeCloseTo(2);
    expect(bill.computerUsd).toBeCloseTo(0.5);
    expect(bill.clientClp).toBe(Math.round(5 * 900));
    expect(splitMeterBuckets(bill.byModel.map((row) => ({ model: row.model, synthetic: false, kind: "CHAT", ...row.tokens }))).apiTokens).toEqual(
      bill.apiTokens,
    );
  });
});
