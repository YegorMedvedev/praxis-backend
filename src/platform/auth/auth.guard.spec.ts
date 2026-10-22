import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Clock } from '../../shared/clock';
import {
  RateLimitedError,
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthenticatedError,
} from '../../shared/domain-error';
import { RateLimiter } from '../http/rate-limiter';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import type { AuthenticatedIdentity } from './identity';
import { Public } from './public.decorator';
import type { TokenVerifier } from './token-verifier';

class FakeVerifier implements TokenVerifier {
  readonly seen: string[] = [];
  constructor(private readonly outcome: AuthenticatedIdentity | Error) {}
  verify(token: string): Promise<AuthenticatedIdentity> {
    this.seen.push(token);
    return this.outcome instanceof Error
      ? Promise.reject(this.outcome)
      : Promise.resolve(this.outcome);
  }
}

const clock: Clock = { now: () => new Date(0) };

class Handlers {
  secured() {}
  @Public()
  open() {}
}

function contextFor(
  request: Partial<AuthenticatedRequest>,
  handler: () => void = Handlers.prototype.secured,
) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Handlers,
  } as unknown as ExecutionContext;
}

const reflector = new Reflector();

function requestWith(authorization?: string, ip = '10.0.0.1') {
  return {
    headers: authorization ? { authorization } : {},
    ip,
  } as unknown as AuthenticatedRequest;
}

describe('AuthGuard', () => {
  const identity = { uid: 'u1', email: 'a@b.c' };

  it('attaches the verified identity to the request', async () => {
    const verifier = new FakeVerifier(identity);
    const guard = new AuthGuard(verifier, new RateLimiter(clock), reflector);
    const request = requestWith('Bearer abc.def.ghi');

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(request.identity).toEqual(identity);
    expect(verifier.seen).toEqual(['abc.def.ghi']);
  });

  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer a b', 'bearer'])(
    'rejects header %p as unauthenticated without calling the verifier',
    async (header) => {
      const verifier = new FakeVerifier(identity);
      const guard = new AuthGuard(verifier, new RateLimiter(clock), reflector);

      await expect(
        guard.canActivate(contextFor(requestWith(header))),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
      expect(verifier.seen).toEqual([]);
    },
  );

  it('accepts a lower-case scheme', async () => {
    const guard = new AuthGuard(
      new FakeVerifier(identity),
      new RateLimiter(clock),
      reflector,
    );

    await expect(
      guard.canActivate(contextFor(requestWith('bearer abc'))),
    ).resolves.toBe(true);
  });

  it('propagates verifier errors unchanged', async () => {
    const expired = new TokenExpiredError('x');
    const guard = new AuthGuard(
      new FakeVerifier(expired),
      new RateLimiter(clock),
      reflector,
    );

    await expect(
      guard.canActivate(contextFor(requestWith('Bearer t'))),
    ).rejects.toBe(expired);
  });

  it('limits authenticated callers per uid', async () => {
    const limiter = new RateLimiter(clock, { limit: 2, windowMs: 60_000 });
    const guard = new AuthGuard(new FakeVerifier(identity), limiter, reflector);
    const call = (ip: string) =>
      guard.canActivate(contextFor(requestWith('Bearer t', ip)));

    await call('1.1.1.1');
    await call('2.2.2.2');

    await expect(call('3.3.3.3')).rejects.toMatchObject({
      constructor: RateLimitedError,
      retryAfterSeconds: 60,
    });
  });

  it('limits failed authentication per client IP', async () => {
    const limiter = new RateLimiter(clock, { limit: 2, windowMs: 60_000 });
    const guard = new AuthGuard(
      new FakeVerifier(new UnauthenticatedError('x')),
      limiter,
      reflector,
    );
    const call = (ip: string) =>
      guard.canActivate(contextFor(requestWith('Bearer t', ip)));

    await expect(call('1.1.1.1')).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call('1.1.1.1')).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call('1.1.1.1')).rejects.toBeInstanceOf(RateLimitedError);
    await expect(call('9.9.9.9')).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('does not charge an IP for dependency outages', async () => {
    const limiter = new RateLimiter(clock, { limit: 1, windowMs: 60_000 });
    const guard = new AuthGuard(
      new FakeVerifier(new ServiceUnavailableError('down')),
      limiter,
      reflector,
    );

    for (let i = 0; i < 3; i++) {
      await expect(
        guard.canActivate(contextFor(requestWith('Bearer t'))),
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
  });

  describe('@Public() routes', () => {
    it('skips token verification and attaches no identity', async () => {
      const verifier = new FakeVerifier(identity);
      const guard = new AuthGuard(verifier, new RateLimiter(clock), reflector);
      const request = requestWith('Bearer would.be.ignored');

      await expect(
        guard.canActivate(contextFor(request, Handlers.prototype.open)),
      ).resolves.toBe(true);

      expect(verifier.seen).toEqual([]);
      expect(request.identity).toBeUndefined();
    });

    it('charges every public request to the client IP limit', async () => {
      const limiter = new RateLimiter(clock, { limit: 2, windowMs: 60_000 });
      const guard = new AuthGuard(
        new FakeVerifier(identity),
        limiter,
        reflector,
      );
      const call = (ip: string) =>
        guard.canActivate(
          contextFor(requestWith(undefined, ip), Handlers.prototype.open),
        );

      await call('1.1.1.1');
      await call('1.1.1.1');

      await expect(call('1.1.1.1')).rejects.toBeInstanceOf(RateLimitedError);
      await expect(call('2.2.2.2')).resolves.toBe(true);
    });

    it('does not make other routes public', async () => {
      const guard = new AuthGuard(
        new FakeVerifier(identity),
        new RateLimiter(clock),
        reflector,
      );

      await expect(
        guard.canActivate(contextFor(requestWith(undefined))),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });
  });
});
