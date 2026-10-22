import type { Clock } from '../../../shared/clock';
import { HashedEmailThrottle } from './hashed-email-throttle';

describe('HashedEmailThrottle', () => {
  let now = 0;
  const clock: Clock = { now: () => new Date(now) };
  beforeEach(() => (now = 0));

  it('allows 3 per hour per address, case-insensitively', () => {
    const throttle = new HashedEmailThrottle(clock);

    expect(throttle.allow('a@example.test')).toBe(true);
    expect(throttle.allow('A@Example.test')).toBe(true);
    expect(throttle.allow('a@example.test')).toBe(true);
    expect(throttle.allow('a@EXAMPLE.test')).toBe(false);
    expect(throttle.allow('b@example.test')).toBe(true);
  });

  it('opens a new window after an hour', () => {
    const throttle = new HashedEmailThrottle(clock);
    for (let i = 0; i < 3; i++) throttle.allow('a@example.test');

    now = 3_600_000;

    expect(throttle.allow('a@example.test')).toBe(true);
  });
});
