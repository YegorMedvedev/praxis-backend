import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/**
 * Opts a route out of bearer-token authentication. Deliberately rare: the
 * Applied to a class it opens EVERY handler of that class, so put it on
 * individual handlers. The global `AuthGuard` still charges the caller's IP to the global rate limit.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
