import { after } from "next/server";
import { logEvent } from "@/lib/log";

/** Corre cuando la respuesta ya salió. La promesa que recibe after espera el trabajo. */
export function scheduleAfterResponse(work: () => Promise<unknown>) {
  try {
    after(async () => {
      try {
        await work();
      } catch {
        logEvent("memoria.despues", { ok: false });
      }
    });
  } catch {
    logEvent("memoria.despues", { ok: false, fuera: true });
  }
}
