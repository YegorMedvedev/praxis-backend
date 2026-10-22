import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RateLimiter } from '../../../platform/http/rate-limiter';
import { RateLimitedError } from '../../../shared/domain-error';
import { PASSWORD_RESET_RATE_LIMITER } from '../auth.tokens';

/**
 * Route-scoped limit for the password-reset request, per client IP
 * (`request.ip` already honours TRUST_PROXY_HOPS). It runs in addition to the
 * global limiter, which the global guard has already charged.
 */
@Injectable()
export class PasswordResetRateLimitGuard implements CanActivate {
  constructor(
    @Inject(PASSWORD_RESET_RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const decision = this.limiter.consume(`ip:${request.ip ?? 'unknown'}`);
    if (!decision.allowed) {
      throw new RateLimitedError(
        'Rate limit exceeded',
        decision.retryAfterSeconds,
      );
    }
    return true;
  }
}
