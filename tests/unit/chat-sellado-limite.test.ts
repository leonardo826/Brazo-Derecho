import { describe, expect, test } from "vitest";
import { carriesSuspectedSecret, prepareComposerTurn, SAFE_CREDENTIAL_ENTRY, sealChatText } from "@/lib/chat/secrets";

const MAX = 4000;

function fill(unit: string, size: number) {
  let text = "";
  while (text.length + unit.length <= size) text += unit;
  if (text.length < size) text += "x".repeat(size - text.length);
  return text.slice(0, size);
}

function measure(text: string) {
  const before = process.memoryUsage().heapUsed;
  const coldStart = performance.now();
  const cold = carriesSuspectedSecret(text);
  const coldMs = performance.now() - coldStart;
  const warm: number[] = [];
  for (let index = 0; index < 5; index += 1) warm.push(timed(text));
  warm.sort((left, right) => left - right);
  return {
    cold,
    coldMs,
    warmMs: warm[Math.floor(warm.length / 2)] ?? 0,
    heapKb: Math.round((process.memoryUsage().heapUsed - before) / 1024),
  };
}

function timed(text: string) {
  const start = performance.now();
  carriesSuspectedSecret(text);
  return performance.now() - start;
}

describe("sellado en el tamaño máximo del mensaje", () => {
  test("4000 etiquetas repetidas caben en el presupuesto y no tapan una credencial final", () => {
    const noise = fill("clave ", MAX);
    const noiseRun = measure(noise);
    expect(noise.length).toBe(MAX);
    expect(noiseRun.cold).toBe(false);
    expect(noiseRun.coldMs).toBeLessThan(500);
    expect(noiseRun.warmMs).toBeLessThan(500);
    expect(noiseRun.heapKb).toBeLessThan(8_192);

    const tail = " Mi contraseña de la cuenta del SII es la de siempre";
    const ended = fill("clave ", MAX - tail.length) + tail;
    const endedRun = measure(ended);
    expect(ended.length).toBe(MAX);
    expect(endedRun.cold).toBe(true);
    expect(sealChatText(ended)).toBe(SAFE_CREDENTIAL_ENTRY);
    expect(prepareComposerTurn(ended, ["nota.pdf"]).files).toEqual([]);
    expect(endedRun.coldMs).toBeLessThan(500);

    const concepts = fill("Mi clave del éxito es constancia. ", MAX);
    const conceptRun = measure(concepts);
    expect(conceptRun.cold).toBe(false);
    expect(prepareComposerTurn(concepts, ["f29.pdf"]).files).toEqual(["f29.pdf"]);
    expect(conceptRun.coldMs).toBeLessThan(500);

    const unicode = fill("clave del éxito es Ñuñoa\n", MAX);
    const unicodeRun = measure(unicode);
    expect(unicodeRun.cold).toBe(false);
    expect(unicodeRun.coldMs).toBeLessThan(500);
  });
});
