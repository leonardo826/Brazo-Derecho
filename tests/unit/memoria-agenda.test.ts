import { beforeEach, describe, expect, test, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());

vi.mock("next/server", () => ({
  after: afterMock,
}));

import { scheduleAfterResponse } from "@/lib/memory/schedule";

describe("extracción después de la respuesta", () => {
  beforeEach(() => {
    afterMock.mockReset();
  });

  test("after recibe una promesa que espera el trabajo", async () => {
    let finished = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scheduleAfterResponse(async () => {
      await gate;
      finished = true;
    });
    expect(afterMock).toHaveBeenCalledTimes(1);
    const callback = afterMock.mock.calls[0]?.[0] as () => Promise<unknown>;
    const pending = callback();
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await pending;
    expect(finished).toBe(true);
  });
});
