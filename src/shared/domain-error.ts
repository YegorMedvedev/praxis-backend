export const ERROR_CODES = [
  'not-found',
  'conflict',
  'validation-failed',
  'unauthenticated',
  'forbidden',
  'incomplete-identity',
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
