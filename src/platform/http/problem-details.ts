import type { ErrorCode } from '../../shared/domain-error';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Relative problem-type URIs, resolved against the API origin. */
const PROBLEM_TYPE_BASE = '/problems/';

export type ProblemName = ErrorCode | 'internal-error';

export interface ProblemDefinition {
  status: number;
  title: string;
}

/** The single table mapping a stable problem name to status and title. */
export const PROBLEMS: Record<ProblemName, ProblemDefinition> = {
  'not-found': { status: 404, title: 'Not Found' },
  conflict: { status: 409, title: 'Conflict' },
  'validation-failed': { status: 422, title: 'Validation Failed' },
  unauthenticated: { status: 401, title: 'Unauthenticated' },
  forbidden: { status: 403, title: 'Forbidden' },
  'incomplete-identity': { status: 403, title: 'Incomplete Identity' },
  'internal-error': { status: 500, title: 'Internal Server Error' },
};

export interface FieldError {
  field: string;
  reason: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: FieldError[];
}

export function problemType(name: ProblemName): string {
  return `${PROBLEM_TYPE_BASE}${name}`;
}
