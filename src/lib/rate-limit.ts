type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (!key || limit < 1 || windowMs < 1) {
    return { ok: false as const, remaining: 0 };
  }
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, remaining: limit - 1 };
  }
  if (current.count >= limit) return { ok: false as const, remaining: 0 };
  current.count += 1;
  return { ok: true as const, remaining: limit - current.count };
}

export function resetRateLimits() {
  buckets.clear();
}
