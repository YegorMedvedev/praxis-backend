import type { Clock } from '../../shared/clock';

export interface RateLimitOptions {
  /** Maximum requests per key per window. */
  limit: number;
  windowMs: number;
  /** Hard cap on tracked keys, bounding memory. */
  maxKeys?: number;
}

/** The one global limit (FR-10): 60 requests per minute per key. */
export const GLOBAL_RATE_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 60_000,
  maxKeys: 10_000,
};

export type RateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Window {
  startedAt: number;
  count: number;
}

/**
 * Fixed-window counter held in process memory. State is per instance: with N
 * instances behind a load balancer the effective limit is up to N times
 * higher. A shared store is needed to make it exact.
 *
 * Memory: the map is kept in window-start order (a rolled-over key is
 * re-inserted), so expired windows are always at the front and are dropped
 * incrementally in amortised O(1). At most `maxKeys` keys are tracked; when
 * the cap is reached with no expired window to evict, a NEW key is refused
 * (fail closed) until the oldest window expires. Existing keys keep working.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly clock: Clock,
    private readonly options: RateLimitOptions = GLOBAL_RATE_LIMIT,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  consume(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    this.evictExpired(now);

    let window = this.windows.get(key);
    if (!window) {
      const maxKeys = this.options.maxKeys ?? Infinity;
      if (this.windows.size >= maxKeys) {
        return this.limited(this.oldestStart() ?? now, now);
      }
      window = { startedAt: now, count: 0 };
      this.windows.set(key, window);
    }

    if (window.count >= this.options.limit) {
      return this.limited(window.startedAt, now);
    }
    window.count += 1;
    return { allowed: true };
  }

  private limited(windowStart: number, now: number): RateLimitDecision {
    const remainingMs = windowStart + this.options.windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  private oldestStart(): number | undefined {
    for (const window of this.windows.values()) return window.startedAt;
    return undefined;
  }

  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt < this.options.windowMs) break;
      this.windows.delete(key);
    }
  }
}
