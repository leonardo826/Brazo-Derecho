import { LiveXaiClient } from "@/lib/xai/live";
import { MockXaiClient } from "@/lib/xai/mock";
import type { XaiClient } from "@/lib/xai/types";

export function xaiBaseUrl() {
  return (process.env.XAI_API_URL?.trim() || "https://api.x.ai/v1").replace(/\/$/, "");
}

export function createXaiClient(): XaiClient {
  const apiKey = process.env.XAI_API_KEY?.trim() ?? "";
  const forceMock = (process.env.XAI_MODE ?? "").trim() === "mock";
  if (!apiKey || forceMock) return new MockXaiClient();
  return new LiveXaiClient({ apiKey, baseUrl: xaiBaseUrl() });
}
