import { COMPUTER_WARMING_MESSAGE } from "@/lib/computer/power-copy";
import { ensureComputerReady, type ReadyResult } from "@/lib/computer/power";
import { consumeRateLimit } from "@/lib/rate-limit";

const LIMIT = 3;
const WINDOW_MS = 60_000;

export async function prewarmOrganization(input: {
  enabled: boolean;
  organizationId: string;
  consume?: typeof consumeRateLimit;
  ensure?: (organizationId: string) => Promise<ReadyResult>;
}) {
  if (!input.enabled || !input.organizationId) return { ok: true as const, skipped: true as const };
  const consume = input.consume ?? consumeRateLimit;
  if (!consume(`computer-prewarm:${input.organizationId}`, LIMIT, WINDOW_MS).ok) {
    return { ok: true as const, limited: true as const };
  }
  const ensure = input.ensure ?? ensureComputerReady;
  const ready = await ensure(input.organizationId);
  if (ready.ok || ready.reason === "ausente" || ready.reason === "apagado") return { ok: true as const };
  return { ok: false as const, message: ready.message || COMPUTER_WARMING_MESSAGE };
}
