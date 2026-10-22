export const ERROR_CODES = [
  'not-found',
  'conflict',
  'validation-failed',
  'unauthenticated',
  'forbidden',
  'incomplete-identity',
  'token-expired',
  'account-disabled',
  'profile-not-found',
  'invalid-request',
  'rate-limited',
  'service-unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Base class for every domain error. Carries a stable machine code and knows
 * nothing about HTTP; `platform/http` maps the code to a problem type.
 */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not-found';
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';
}

export class ValidationFailedError extends DomainError {
  readonly code = 'validation-failed';
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'unauthenticated';
}

export class ForbiddenError extends DomainError {
  readonly code = 'forbidden';
}

export class IncompleteIdentityError extends DomainError {
  readonly code = 'incomplete-identity';
}

export class TokenExpiredError extends DomainError {
  readonly code = 'token-expired';
}

export class AccountDisabledError extends DomainError {
  readonly code = 'account-disabled';
}

export class ProfileNotFoundError extends DomainError {
  readonly code = 'profile-not-found';
}

export class ServiceUnavailableError extends DomainError {
  readonly code = 'service-unavailable';
}

/** Master list of `invalid_params` reasons (spec signup-login/06). */
export const INVALID_PARAM_REASONS = [
  'REQUIRED',
  'TOO_SHORT',
  'TOO_LONG',
  'INVALID_TYPE',
  'INVALID_VALUE',
  'UNKNOWN_VERSION',
  'OUT_OF_RANGE',
] as const;

export type InvalidParamReason = (typeof INVALID_PARAM_REASONS)[number];

export interface InvalidParam {
  name: string;
  reason: InvalidParamReason;
}

export class InvalidRequestError extends DomainError {
  readonly code = 'invalid-request';

  constructor(
    message: string,
    readonly params: readonly InvalidParam[] = [],
  ) {
    super(message);
  }
}

export class RateLimitedError extends DomainError {
  readonly code = 'rate-limited';

  constructor(
    message: string,
    /** Whole seconds until the caller may retry. */
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}
