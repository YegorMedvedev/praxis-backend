import type { ErrorCode } from '../../shared/domain-error';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Relative problem-type URIs, resolved against the API origin. */
const PROBLEM_TYPE_BASE = '/problems/';

export type ProblemName = ErrorCode | 'internal-error';

export interface ProblemDefinition {
  status: number;
  title: string;
  /**
   * Constant detail that always replaces the occurrence-specific one. Used
   * where a specific reason must not be revealed (NFR-3) or could leak
   * implementation detail.
   */
  detail?: string;
}

const UNAUTHENTICATED_DETAIL = 'Valid bearer credentials are required.';

/**
 * The single table mapping a stable problem name to status and title.
 * The two 401 types share title and detail on purpose: they must differ only
 * in `type` (NFR-3 / AC-16).
 */
export const PROBLEMS: Record<ProblemName, ProblemDefinition> = {
  'not-found': { status: 404, title: 'Not Found' },
  conflict: { status: 409, title: 'Conflict' },
  'validation-failed': { status: 422, title: 'Validation Failed' },
  unauthenticated: {
    status: 401,
    title: 'Unauthorized',
    detail: UNAUTHENTICATED_DETAIL,
  },
  'token-expired': {
    status: 401,
    title: 'Unauthorized',
    detail: UNAUTHENTICATED_DETAIL,
  },
  forbidden: { status: 403, title: 'Forbidden' },
  'incomplete-identity': { status: 403, title: 'Incomplete Identity' },
  'account-disabled': { status: 403, title: 'Account Disabled' },
  'profile-not-found': { status: 404, title: 'Profile Not Found' },
  'case-not-found': { status: 404, title: 'Case Not Found' },
  'session-not-found': { status: 404, title: 'Session Not Found' },
  'session-ended': { status: 409, title: 'Session Ended' },
  'reply-pending': { status: 409, title: 'Reply Pending' },
  'no-reply-pending': { status: 409, title: 'No Reply Pending' },
  'reply-generation-failed': {
    status: 502,
    title: 'Reply Generation Failed',
    detail: 'The patient reply could not be produced.',
  },
  'invalid-request': { status: 400, title: 'Invalid Request' },
  'rate-limited': { status: 429, title: 'Too Many Requests' },
  'internal-error': {
    status: 500,
    title: 'Internal Server Error',
    detail: 'An unexpected error occurred.',
  },
  'service-unavailable': {
    status: 503,
    title: 'Service Unavailable',
    detail: 'A required dependency is temporarily unavailable.',
  },
};

export interface InvalidParamEntry {
  name: string;
  reason: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  flow_id: string;
  invalid_params?: InvalidParamEntry[];
}

export function problemType(name: ProblemName): string {
  return `${PROBLEM_TYPE_BASE}${name}`;
}

/**
 * A complete problem object for a stable name. Used where the problem is not
 * an HTTP response body (the SSE `error` event), so the mapping from name to
 * status, type and title still lives in this one table.
 */
export function toProblem(
  name: ProblemName,
  instance: string,
  flowId: string,
): ProblemDetails {
  const { status, title, detail } = PROBLEMS[name];
  return {
    type: problemType(name),
    title,
    status,
    ...(detail ? { detail } : {}),
    instance,
    flow_id: flowId,
  };
}
