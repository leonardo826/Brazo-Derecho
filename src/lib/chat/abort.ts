/** A consult is reserved only when the answer is saved. Stopping the stream skips that. */
export function streamWasStopped(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function chunkGapMs(usesNetwork: boolean, env: Record<string, string | undefined> = process.env) {
  if (usesNetwork || env.VITEST === "true") return 0;
  const raw = Number(env.CHAT_STREAM_CHUNK_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(Math.floor(raw), 5_000);
  return 12;
}

export function waitChunk(signal: AbortSignal | undefined, ms: number) {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

export function linkAbortSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (signal.aborted) return signal;
  return AbortSignal.any([timeout, signal]);
}
