import { describe, expect, test } from "vitest";
import { chunkGapMs, isAbortError, streamWasStopped, waitChunk } from "@/lib/chat/abort";
import { completeTurn, pushTurn, releasePaused, requeueFront } from "@/lib/chat/followups";
import type { ChatClientEvent, PublicMessage } from "@/lib/chat/public";
import { forwardEvents } from "@/lib/chat/sse";
import { insertBeforeQueue, placeThreadMessage, replaceOptimisticUser } from "@/lib/chat/thread";

function message(partial: Pick<PublicMessage, "id" | "role" | "body"> & Partial<PublicMessage>): PublicMessage {
  return {
    kind: "TEXT",
    action: "",
    actionTitle: "",
    confirmation: null,
    createdAt: "2026-11-05T11:20:00.000Z",
    attachments: [],
    ...partial,
  };
}

describe("cola del compositor", () => {
  test("un envío durante la respuesta queda en espera y no parte otro stream", () => {
    const idle = { active: null, waiting: [] as { id: string }[] };
    const first = pushTurn(idle, { id: "a" });
    expect(first.startNow).toBe(true);
    const second = pushTurn(first.queue, { id: "b" });
    expect(second.startNow).toBe(false);
    expect(second.queue.active?.id).toBe("a");
    expect(second.queue.waiting.map((item) => item.id)).toEqual(["b"]);
  });

  test("al terminar o detener sigue el siguiente; un error deja la cola pausada", () => {
    const queued = { active: { id: "a" }, waiting: [{ id: "b" }, { id: "c" }] };
    const done = completeTurn(queued, "done");
    expect(done.next?.id).toBe("b");
    expect(done.queue.waiting.map((item) => item.id)).toEqual(["c"]);
    const aborted = completeTurn(queued, "abort");
    expect(aborted.next?.id).toBe("b");
    const failed = completeTurn(queued, "error");
    expect(failed.next).toBeNull();
    expect(failed.queue.waiting.map((item) => item.id)).toEqual(["b", "c"]);
    const resumed = releasePaused(failed.queue);
    expect(resumed.next?.id).toBe("b");
    expect(resumed.queue.active?.id).toBe("b");
  });

  test("si el compositor está ocupado, el fallo vuelve al frente de la espera", () => {
    const paused = { active: null, waiting: [{ id: "b" }] };
    const next = requeueFront(paused, { id: "a" });
    expect(next.active).toBeNull();
    expect(next.waiting.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("orden del hilo con mensajes en espera", () => {
  test("el mensaje guardado reemplaza al optimista sin pasar sobre la cola", () => {
    const items = [
      message({ id: "local-a", role: "USER", body: "ALFA" }),
      message({ id: "local-b", role: "USER", body: "BETA" }),
    ];
    const saved = message({ id: "db-a", role: "USER", body: "ALFA" });
    const next = replaceOptimisticUser(items, saved, "local-a");
    expect(next.map((item) => item.id)).toEqual(["db-a", "local-b"]);
  });

  test("la respuesta en curso queda arriba del mensaje que sigue en espera", () => {
    const items = [
      message({ id: "db-a", role: "USER", body: "ALFA" }),
      message({ id: "local-b", role: "USER", body: "BETA" }),
    ];
    const answer = message({ id: "asst-1", role: "ASSISTANT", body: "Respuesta de prueba para: ALFA" });
    const placed = placeThreadMessage(items, answer, "", ["local-b"]);
    expect(placed.map((item) => item.id)).toEqual(["db-a", "asst-1", "local-b"]);
    const stopped = message({ id: "local-stop-1", role: "ASSISTANT", body: "Detuviste la respuesta." });
    expect(insertBeforeQueue(items, stopped, ["local-b"]).map((item) => item.id)).toEqual([
      "db-a",
      "local-stop-1",
      "local-b",
    ]);
  });
});

describe("corte del stream", () => {
  test("al abortar no se entregan los eventos que siguen", async () => {
    const controller = new AbortController();
    async function* events(): AsyncGenerator<ChatClientEvent> {
      yield { type: "delta", text: "ALFA" };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (controller.signal.aborted) return;
      yield { type: "delta", text: " no deberías verme" };
      yield { type: "done" };
    }
    const seen: string[] = [];
    const pending = forwardEvents(events(), controller.signal, (event) => {
      if (event.type === "delta") seen.push(event.text);
      controller.abort();
    });
    await expect(pending).resolves.toBe("abort");
    expect(seen).toEqual(["ALFA"]);
    expect(streamWasStopped(controller.signal)).toBe(true);
  });

  test("un AbortError se reconoce y la pausa del simulador se corta", async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
    expect(isAbortError(new Error("otra"))).toBe(false);
    const controller = new AbortController();
    const pending = waitChunk(controller.signal, 5_000);
    controller.abort();
    await pending;
    expect(controller.signal.aborted).toBe(true);
  });

  test("el simulador puede alargar los trozos sin tocar la red ni vitest", () => {
    expect(chunkGapMs(true, { CHAT_STREAM_CHUNK_MS: "900" })).toBe(0);
    expect(chunkGapMs(false, { VITEST: "true", CHAT_STREAM_CHUNK_MS: "900" })).toBe(0);
    expect(chunkGapMs(false, {})).toBe(12);
    expect(chunkGapMs(false, { CHAT_STREAM_CHUNK_MS: "900" })).toBe(900);
    expect(chunkGapMs(false, { CHAT_STREAM_CHUNK_MS: "99999" })).toBe(5_000);
  });
});
