import { MockXaiClient } from "@/lib/xai/mock";
import type { XaiClient } from "@/lib/xai/types";

export function createXaiClient(): XaiClient {
  const mode = process.env.XAI_MODE ?? "mock";
  if (mode !== "mock") {
    throw new Error("XAI_MODE=live no está disponible en la beta. Usa el cliente mock.");
  }
  return new MockXaiClient();
}
