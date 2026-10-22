import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';
import type { AuthenticatedIdentity } from './identity';

/** Injects the verified caller; only valid behind the global `AuthGuard`. */
export const CurrentIdentity = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedIdentity => {
    const { identity } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!identity) {
      throw new Error('CurrentIdentity used on an unauthenticated route');
    }
    return identity;
  },
);
