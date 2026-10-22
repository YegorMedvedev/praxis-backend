import { join } from 'node:path';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export const EMULATOR_PROJECT_ID = 'demo-praxis-e2e';

export interface FirebaseEmulator {
  container: StartedTestContainer;
  /** host:port to export as FIREBASE_AUTH_EMULATOR_HOST. */
  host: string;
  /** Creates a password user and returns its (unsigned) emulator ID token. */
  signUp(email: string): Promise<{ idToken: string; uid: string }>;
}

/** Starts an isolated Firebase Auth emulator via Testcontainers. */
export async function startFirebaseEmulator(): Promise<FirebaseEmulator> {
  const image = await GenericContainer.fromDockerfile(
    join(__dirname, 'firebase-emulator'),
  ).build('praxis-e2e-firebase-auth-emulator:1', { deleteOnExit: false });

  const container = await image
    .withExposedPorts(9099)
    .withWaitStrategy(Wait.forLogMessage(/All emulators ready/))
    .withStartupTimeout(180_000)
    .start();
  const host = `${container.getHost()}:${container.getMappedPort(9099)}`;

  return {
    container,
    host,
    async signUp(email) {
      const response = await fetch(
        `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            password: 'correct-horse-battery',
            returnSecureToken: true,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`emulator sign-up failed with ${response.status}`);
      }
      const body = (await response.json()) as {
        idToken: string;
        localId: string;
      };
      return { idToken: body.idToken, uid: body.localId };
    },
  };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** Hand-built unsigned token in the shape the emulator issues. */
export function craftEmulatorToken(claims: {
  projectId: string;
  uid: string;
  email: string;
  expiresInSeconds: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${claims.projectId}`,
    aud: claims.projectId,
    sub: claims.uid,
    user_id: claims.uid,
    email: claims.email,
    auth_time: now - 7200,
    iat: now - 7200,
    exp: now + claims.expiresInSeconds,
    firebase: { sign_in_provider: 'password', identities: {} },
  };
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
}
