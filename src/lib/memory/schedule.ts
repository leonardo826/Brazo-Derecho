import { after } from "next/server";
import { logEvent } from "@/lib/log";

/** Corre cuando la respuesta ya salió. Si no hay petición, no bloquea ni ejecuta en línea. */
export function scheduleAfterResponse(work: () => Promise<unknown>) {
  try {
    after(() => {
      void Promise.resolve()
        .then(work)
        .catch(() => {
          logEvent("memoria.despues", { ok: false });
        });
    });
  } catch {
    logEvent("memoria.despues", { ok: false, fuera: true });
  }
}
