import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  RateLimitedError,
  TokenExpiredError,
  UnauthenticatedError,
} from '../../shared/domain-error';
import type { RateLimiter } from '../http/rate-limiter';
import { RATE_LIMITER, TOKEN_VERIFIER } from './auth.tokens';
import type { AuthenticatedIdentity } from './identity';
import { IS_PUBLIC } from './public.decorator';
import type { TokenVerifier } from './token-verifier';

export interface AuthenticatedRequest extends Request {
  identity?: AuthenticatedIdentity;
}

const BEARER = /^Bearer ([^\s]+)$/i;

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  return typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
}

/**
 * Global guard: every endpoint is authenticated unless it is explicitly marked
 * `@Public()` (currently only the password-reset request, which AGENTS.md
 * defines as unauthenticated; public requests are charged to the client IP).
 * It also applies the single rate limit, which needs the resolved identity: keyed by
 * uid when authentication succeeds, by client IP when it fails.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      this.enforce(`ip:${request.ip ?? 'unknown'}`);
      return true;
    }

    let identity: AuthenticatedIdentity;
    try {
      const token = bearerToken(request);
      if (!token) {
        throw new UnauthenticatedError('Bearer token missing or malformed');
      }
      identity = await this.verifier.verify(token);
    } catch (error) {
      if (
        error instanceof UnauthenticatedError ||
        error instanceof TokenExpiredError
      ) {
        this.enforce(`ip:${request.ip ?? 'unknown'}`);
      }
      throw error;
    }

    this.enforce(`uid:${identity.uid}`);
    request.identity = identity;
    return true;
  }

  private enforce(key: string): void {
    const decision = this.limiter.consume(key);
    if (!decision.allowed) {
      throw new RateLimitedError(
        'Rate limit exceeded',
        decision.retryAfterSeconds,
      );
    }
  }
}
