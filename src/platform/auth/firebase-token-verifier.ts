import type { AppConfig } from '../config/app-config';
import {
  AccountDisabledError,
  DomainError,
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthenticatedError,
} from '../../shared/domain-error';
import { getFirebaseAuth } from './firebase-app';
import type { AuthenticatedIdentity } from './identity';
import type { TokenVerifier } from './token-verifier';

/** The slice of the Firebase Admin `Auth` this adapter uses. */
export interface IdTokenVerifierClient {
  verifyIdToken(
    idToken: string,
    checkRevoked?: boolean,
  ): Promise<{ uid: string; email?: string }>;
}

const KEY_FETCH_FAILURE = /Error fetching public keys/i;
const TRANSIENT_CODES = new Set([
  'auth/internal-error',
  'app/network-error',
  'auth/network-error',
]);

function translate(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';

  if (code === 'auth/id-token-expired') {
    return new TokenExpiredError('ID token expired');
  }
  if (code === 'auth/user-disabled') {
    return new AccountDisabledError('Account is disabled');
  }
  if (
    (typeof code === 'string' && TRANSIENT_CODES.has(code)) ||
    KEY_FETCH_FAILURE.test(message)
  ) {
    return new ServiceUnavailableError('Token verification keys unavailable');
  }
  // Messages from the SDK can quote token content, so none is propagated.
  return new UnauthenticatedError('ID token rejected');
}

/**
 * Verifies Firebase ID tokens locally against Google's published signing keys
 * (the SDK caches them per Cache-Control). `checkRevoked` is deliberately off:
 * revocation or a disabled user takes effect when the token expires (NFR-2).
 * Known deviation from FR-1: the SDK refetches keys on cache expiry, not on
 * every unknown `kid`, so a key rotation is picked up at the next max-age.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: IdTokenVerifierClient) {}

  async verify(token: string): Promise<AuthenticatedIdentity> {
    try {
      const decoded = await this.auth.verifyIdToken(token);
      if (!decoded.uid) {
        throw new UnauthenticatedError('ID token has no subject');
      }
      return { uid: decoded.uid, email: decoded.email };
    } catch (error) {
      throw translate(error);
    }
  }
}

export function createFirebaseTokenVerifier(
  config: Pick<AppConfig, 'FIREBASE_PROJECT_ID' | 'FIREBASE_CREDENTIALS_JSON'>,
): TokenVerifier {
  return new FirebaseTokenVerifier(getFirebaseAuth(config));
}
