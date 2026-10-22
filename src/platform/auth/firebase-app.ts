import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { AppConfig } from '../config/app-config';

const APP_NAME = 'praxis-auth';

/** Parses the service-account JSON; never lets the SDK/JSON error text escape. */
function credentialFrom(json: string) {
  try {
    return cert(JSON.parse(json) as object);
  } catch {
    // The underlying message can quote fragments of the secret.
    throw new Error('FIREBASE_CREDENTIALS_JSON is not a valid service account');
  }
}

/**
 * The one Firebase Admin app of this process (created on first use), shared by
 * token verification and by modules that need the Admin `Auth` client.
 */
export function getFirebaseAuth(
  config: Pick<AppConfig, 'FIREBASE_PROJECT_ID' | 'FIREBASE_CREDENTIALS_JSON'>,
): Auth {
  const app =
    getApps().find((candidate) => candidate.name === APP_NAME) ??
    initializeApp(
      {
        projectId: config.FIREBASE_PROJECT_ID,
        ...(config.FIREBASE_CREDENTIALS_JSON
          ? { credential: credentialFrom(config.FIREBASE_CREDENTIALS_JSON) }
          : {}),
      },
      APP_NAME,
    );
  return getAuth(app);
}
