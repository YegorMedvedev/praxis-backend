import type { Clock } from '../../shared/clock';
import { RateLimiter } from './rate-limiter';

class FakeClock implements Clock {
  constructor(private time = 1_000_000) {}
  now(): Date {
    return new Date(this.time);
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

describe('RateLimiter', () => {
  const options = { limit: 3, windowMs: 60_000 };

  it('allows up to the limit then rejects with a retry delay', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, options);

    for (let i = 0; i < 3; i++) {
      expect(limiter.consume('u1')).toEqual({ allowed: true });
    }
    clock.advance(15_500);

    expect(limiter.consume('u1')).toEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
  });

  it('counts each key separately', () => {
    const limiter = new RateLimiter(new FakeClock(), options);
    for (let i = 0; i < 3; i++) limiter.consume('u1');

    expect(limiter.consume('u1').allowed).toBe(false);
    expect(limiter.consume('u2').allowed).toBe(true);
  });

  it('starts a fresh window once the previous one has elapsed', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, options);
    for (let i = 0; i < 4; i++) limiter.consume('u1');

    clock.advance(60_000);

    expect(limiter.consume('u1')).toEqual({ allowed: true });
  });

  it('never reports a retry delay below one second', () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter(clock, options);
    for (let i = 0; i < 3; i++) limiter.consume('u1');
    clock.advance(59_999);

    expect(limiter.consume('u1')).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  describe('key cap', () => {
    const capped = { limit: 3, windowMs: 60_000, maxKeys: 2 };

    it('fails closed for a new key once the cap is reached', () => {
      const clock = new FakeClock();
      const limiter = new RateLimiter(clock, capped);
      limiter.consume('a');
      clock.advance(10_000);
      limiter.consume('b');
      clock.advance(5_000);

      expect(limiter.consume('c')).toEqual({
        allowed: false,
        retryAfterSeconds: 45,
      });
      expect(limiter.consume('a').allowed).toBe(true);
    });

    it('evicts expired windows before refusing a new key', () => {
      const clock = new FakeClock();
      const limiter = new RateLimiter(clock, capped);
      limiter.consume('a');
      limiter.consume('b');
      clock.advance(60_000);

      expect(limiter.consume('c')).toEqual({ allowed: true });
      expect(limiter.size).toBe(1);
    });

    it('keeps tracked keys bounded under a flood of distinct keys', () => {
      const limiter = new RateLimiter(new FakeClock(), {
        limit: 3,
        windowMs: 60_000,
        maxKeys: 100,
      });
      for (let i = 0; i < 1_000; i++) limiter.consume(`k${i}`);

      expect(limiter.size).toBe(100);
    });
  });
});
