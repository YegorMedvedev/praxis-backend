import {
  FirebasePasswordResetLinkGenerator,
  type PasswordResetLinkClient,
} from './firebase-password-reset-link-generator';

function clientThatRejects(code: string): PasswordResetLinkClient {
  return {
    generatePasswordResetLink: () =>
      Promise.reject(Object.assign(new Error('secret@example.test'), { code })),
  };
}

describe('FirebasePasswordResetLinkGenerator', () => {
  it('returns the link the Admin SDK generated', async () => {
    const seen: string[] = [];
    const generator = new FirebasePasswordResetLinkGenerator({
      generatePasswordResetLink: (email) => {
        seen.push(email);
        return Promise.resolve('https://x.test/action?oobCode=abc');
      },
    });

    await expect(generator.generate('a@example.test')).resolves.toBe(
      'https://x.test/action?oobCode=abc',
    );
    expect(seen).toEqual(['a@example.test']);
  });

  it.each(['auth/user-not-found', 'auth/email-not-found'])(
    'maps %s to "no such user"',
    async (code) => {
      const generator = new FirebasePasswordResetLinkGenerator(
        clientThatRejects(code),
      );

      await expect(generator.generate('a@example.test')).resolves.toBeNull();
    },
  );

  it('lets any other failure propagate (the use case reports it silently)', async () => {
    const generator = new FirebasePasswordResetLinkGenerator(
      clientThatRejects('auth/internal-error'),
    );

    await expect(generator.generate('a@example.test')).rejects.toBeInstanceOf(
      Error,
    );
  });
});
