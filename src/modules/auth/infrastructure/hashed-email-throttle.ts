import { createHash } from 'node:crypto';
import { RateLimiter } from '../../../platform/http/rate-limiter';
import type { Clock } from '../../../shared/clock';
import type { PasswordResetThrottle } from '../domain/password-reset-throttle';

/**
 * In-memory, per instance: 3 requests per hour per address. Keys are SHA-256
 * of the lowercased address, so no address is held in memory. Bounded to
 * 10,000 keys; when full, NEW addresses are refused (fail closed) until the
 * oldest window expires.
 */
export class HashedEmailThrottle implements PasswordResetThrottle {
  private readonly limiter: RateLimiter;

  constructor(clock: Clock, limit = 3, windowMs = 3_600_000) {
    this.limiter = new RateLimiter(clock, { limit, windowMs, maxKeys: 10_000 });
  }

  allow(email: string): boolean {
    const key = createHash('sha256').update(email.toLowerCase()).digest('hex');
    return this.limiter.consume(key).allowed;
  }
}
