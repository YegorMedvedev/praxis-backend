import { UnauthenticatedError } from '../../shared/domain-error';
import { createFirebaseTokenVerifier } from './firebase-token-verifier';

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

function unsignedToken(header: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT', ...header })}.${b64({
    iss: 'https://securetoken.google.com/fake-project',
    aud: 'fake-project',
    sub: 'someone',
    iat: now - 10,
    exp: now + 3600,
    auth_time: now - 10,
  })}.`;
}

describe('createFirebaseTokenVerifier', () => {
  const saved = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  afterEach(() => {
    if (saved === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = saved;
  });

  it('never leaks credential fragments when the JSON is invalid', () => {
    const attempt = () =>
      createFirebaseTokenVerifier({
        FIREBASE_PROJECT_ID: 'fake-project',
        FIREBASE_CREDENTIALS_JSON: '{"private_key": "SECRETFRAGMENT',
      });

    expect(attempt).toThrow('FIREBASE_CREDENTIALS_JSON');
    expect(attempt).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('SECRETFRAGMENT'),
      }),
    );
  });

  describe('without the emulator (no network needed)', () => {
    // Rejected from the token header, before any signing key is fetched.
    it.each([{}, { kid: 'some-kid' }])(
      'rejects an unsigned alg:none token (header %p)',
      async (header) => {
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const verifier = createFirebaseTokenVerifier({
          FIREBASE_PROJECT_ID: 'fake-project',
        });

        await expect(
          verifier.verify(unsignedToken(header)),
        ).rejects.toBeInstanceOf(UnauthenticatedError);
      },
    );
  });
});
