import type { ExecutionContext } from '@nestjs/common';
import type { Clock } from '../../../shared/clock';
import { RateLimitedError } from '../../../shared/domain-error';
import { RateLimiter } from '../../../platform/http/rate-limiter';
import { PasswordResetRateLimitGuard } from './password-reset-rate-limit.guard';

function contextFor(ip: string | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as unknown as ExecutionContext;
}

describe('PasswordResetRateLimitGuard', () => {
  let now = 0;
  const clock: Clock = { now: () => new Date(now) };
  const limiter = () => new RateLimiter(clock, { limit: 2, windowMs: 60_000 });

  beforeEach(() => {
    now = 0;
  });

  it('allows up to the limit per client IP then answers rate-limited', () => {
    const guard = new PasswordResetRateLimitGuard(limiter());

    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
    expect(() => guard.canActivate(contextFor('1.1.1.1'))).toThrow(
      expect.objectContaining({
        constructor: RateLimitedError,
        retryAfterSeconds: 60,
      }),
    );
    expect(guard.canActivate(contextFor('2.2.2.2'))).toBe(true);
  });

  it('opens a new window after the window elapsed', () => {
    const guard = new PasswordResetRateLimitGuard(limiter());
    guard.canActivate(contextFor('1.1.1.1'));
    guard.canActivate(contextFor('1.1.1.1'));

    now = 60_000;

    expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
  });
});
