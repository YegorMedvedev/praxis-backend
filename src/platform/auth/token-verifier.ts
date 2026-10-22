import type { AuthenticatedIdentity } from './identity';

/**
 * Verifies a bearer ID token locally (no per-request call to the identity
 * provider, NFR-4). Rejects with a `DomainError`: `UnauthenticatedError`,
 * `TokenExpiredError`, `AccountDisabledError`, or `ServiceUnavailableError`
 * when the verification keys cannot be obtained.
 */
export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedIdentity>;
}
