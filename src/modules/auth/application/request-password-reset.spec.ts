import {
  CountingThrottle,
  FakePasswordResetLinkGenerator,
  InMemoryPasswordResetMailer,
  RecordingFailureReporter,
  TrackingBackgroundRunner,
} from './fakes';
import { RequestPasswordReset } from './request-password-reset';

const ORIGIN = 'https://app.example.test';

function setup(known: string[] = ['known@example.test']) {
  const generator = new FakePasswordResetLinkGenerator(new Set(known));
  const mailer = new InMemoryPasswordResetMailer();
  const failures = new RecordingFailureReporter();
  const runner = new TrackingBackgroundRunner();
  const throttle = new CountingThrottle(3);
  const inner = new RequestPasswordReset(
    generator,
    mailer,
    ORIGIN,
    failures,
    runner,
    throttle,
  );
  // Tests await the background work after each request.
  const useCase = {
    async execute(command: Parameters<typeof inner.execute>[0]) {
      await inner.execute(command);
      await runner.idle();
    },
  };
  return { generator, mailer, failures, useCase, inner, runner };
}

describe('RequestPasswordReset', () => {
  it('mails the app link built from the oobCode of the generated link', async () => {
    const { useCase, mailer } = setup();

    await useCase.execute({ email: 'known@example.test', language: 'ru' });

    expect(mailer.sent).toEqual([
      {
        to: 'known@example.test',
        language: 'ru',
        link: `${ORIGIN}/auth-action?mode=resetPassword&oobCode=code-for-known%40example.test&lang=ru`,
      },
    ]);
  });

  it('never carries the identity-provider host into the link', async () => {
    const { useCase, mailer } = setup();

    await useCase.execute({ email: 'known@example.test', language: 'en' });

    expect(mailer.sent[0].link.startsWith(`${ORIGIN}/auth-action?`)).toBe(true);
    expect(mailer.sent[0].link).not.toContain('firebaseapp');
    expect(mailer.sent[0].link).not.toContain('apiKey');
  });

  it('succeeds silently and sends nothing for an unknown address', async () => {
    const { useCase, mailer, failures } = setup();

    await expect(
      useCase.execute({ email: 'stranger@example.test', language: 'en' }),
    ).resolves.toBeUndefined();

    expect(mailer.sent).toEqual([]);
    expect(failures.reports).toEqual([]);
  });

  it('swallows a generator failure and reports only the error class', async () => {
    const { useCase, generator, mailer, failures } = setup();
    class QuotaExceeded extends Error {}
    generator.failWith = new QuotaExceeded('known@example.test oobCode=zzz');

    await expect(
      useCase.execute({ email: 'known@example.test', language: 'en' }),
    ).resolves.toBeUndefined();

    expect(mailer.sent).toEqual([]);
    expect(failures.reports).toEqual([
      { stage: 'link-generation', errorName: 'QuotaExceeded' },
    ]);
  });

  it('swallows a mailer failure and reports only the error class', async () => {
    const { useCase, mailer, failures } = setup();
    class ResendDown extends Error {}
    mailer.failWith = new ResendDown('key re_secret');

    await expect(
      useCase.execute({ email: 'known@example.test', language: 'en' }),
    ).resolves.toBeUndefined();

    expect(failures.reports).toEqual([
      { stage: 'mailing', errorName: 'ResendDown' },
    ]);
  });

  it('treats a generated link without an oobCode as a silent failure', async () => {
    const generator = new FakePasswordResetLinkGenerator(
      new Set(['known@example.test']),
      () =>
        'https://project.firebaseapp.test/__/auth/action?mode=resetPassword',
    );
    const mailer = new InMemoryPasswordResetMailer();
    const failures = new RecordingFailureReporter();
    const runner = new TrackingBackgroundRunner();
    const useCase = new RequestPasswordReset(
      generator,
      mailer,
      ORIGIN,
      failures,
      runner,
      new CountingThrottle(),
    );

    await expect(
      useCase.execute({ email: 'known@example.test', language: 'en' }),
    ).resolves.toBeUndefined();
    await runner.idle();

    expect(mailer.sent).toEqual([]);
    expect(failures.reports).toEqual([
      { stage: 'link-parsing', errorName: 'MalformedResetLink' },
    ]);
  });

  it('copes with a thrown non-Error value', async () => {
    const { useCase, generator, failures } = setup();
    generator.failWith = 'boom' as unknown as Error;

    await useCase.execute({ email: 'known@example.test', language: 'en' });

    expect(failures.reports[0].errorName).toBe('UnknownError');
  });

  describe('background execution', () => {
    function deferred() {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      return { promise, resolve };
    }

    it('answers while the link generator and the mailer are still pending', async () => {
      const { inner, generator, mailer, runner } = setup();
      const genGate = deferred();
      const mailGate = deferred();
      const realGenerate = generator.generate.bind(generator);
      generator.generate = async (email) => {
        await genGate.promise;
        return realGenerate(email);
      };
      mailer.send = async (mail) => {
        await mailGate.promise;
        mailer.sent.push(mail);
      };

      await inner.execute({ email: 'known@example.test', language: 'en' });
      expect(mailer.sent).toEqual([]);

      genGate.resolve();
      mailGate.resolve();
      await runner.idle();
      expect(mailer.sent).toHaveLength(1);
    });

    it('does not reject or leak an unhandled rejection when the background run fails', async () => {
      const { inner, generator, runner } = setup();
      generator.failWith = new Error('boom');

      await expect(
        inner.execute({ email: 'known@example.test', language: 'en' }),
      ).resolves.toBeUndefined();
      await expect(runner.idle()).resolves.toBeUndefined();
    });
  });

  describe('per-address throttle', () => {
    it('silently stops mailing after the limit and reports only the event', async () => {
      const { useCase, mailer, failures } = setup();

      for (let i = 0; i < 5; i++) {
        await useCase.execute({ email: 'known@example.test', language: 'en' });
      }

      expect(mailer.sent).toHaveLength(3);
      expect(failures.reports).toEqual([
        { stage: 'throttled', errorName: 'RateLimited' },
        { stage: 'throttled', errorName: 'RateLimited' },
      ]);
    });
  });
});
