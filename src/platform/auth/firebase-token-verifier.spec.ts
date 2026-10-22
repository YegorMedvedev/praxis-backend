import {
  AccountDisabledError,
  ServiceUnavailableError,
  TokenExpiredError,
  UnauthenticatedError,
} from '../../shared/domain-error';
import {
  FirebaseTokenVerifier,
  type IdTokenVerifierClient,
} from './firebase-token-verifier';

function verifierThatFails(error: unknown) {
  const verifyIdToken = jest.fn().mockRejectedValue(error);
  return {
    verifier: new FirebaseTokenVerifier({
      verifyIdToken,
    } as IdTokenVerifierClient),
    verifyIdToken,
  };
}

const sdkError = (code: string, message = 'sdk message') =>
  Object.assign(new Error(message), { code });

describe('FirebaseTokenVerifier', () => {
  it('returns uid and email without checking revocation', async () => {
    const verifyIdToken = jest
      .fn()
      .mockResolvedValue({ uid: 'u1', email: 'a@b.c', other: 1 });
    const verifier = new FirebaseTokenVerifier({ verifyIdToken });

    await expect(verifier.verify('tok')).resolves.toEqual({
      uid: 'u1',
      email: 'a@b.c',
    });
    expect(verifyIdToken).toHaveBeenCalledWith('tok');
  });

  it.each([
    [sdkError('auth/id-token-expired'), TokenExpiredError],
    [sdkError('auth/user-disabled'), AccountDisabledError],
    [sdkError('auth/argument-error'), UnauthenticatedError],
    [new Error('anything'), UnauthenticatedError],
    [sdkError('auth/internal-error'), ServiceUnavailableError],
    [
      sdkError(
        'auth/argument-error',
        'Error fetching public keys for Google certs: x',
      ),
      ServiceUnavailableError,
    ],
  ])('translates %p', async (error, expected) => {
    const { verifier } = verifierThatFails(error);

    await expect(verifier.verify('tok')).rejects.toBeInstanceOf(expected);
  });

  it('rejects a token without a subject', async () => {
    const verifier = new FirebaseTokenVerifier({
      verifyIdToken: jest.fn().mockResolvedValue({ uid: '' }),
    });

    await expect(verifier.verify('tok')).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('never propagates the SDK message', async () => {
    const { verifier } = verifierThatFails(
      sdkError('auth/argument-error', 'token eyJsecret is bad'),
    );

    await expect(verifier.verify('tok')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('eyJsecret'),
      }),
    );
  });
});
