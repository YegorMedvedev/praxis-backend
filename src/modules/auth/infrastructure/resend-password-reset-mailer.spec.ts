import {
  ResendPasswordResetMailer,
  ResendRequestError,
  type HttpClient,
} from './resend-password-reset-mailer';

const link =
  'https://app.example.test/auth-action?mode=resetPassword&oobCode=c&lang=ru';

function recorder(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const http: HttpClient = (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response('{"id":"1"}', { status }));
  };
  return { calls, http };
}

describe('ResendPasswordResetMailer', () => {
  it('posts one localized message to the Resend emails endpoint', async () => {
    const { calls, http } = recorder();
    const mailer = new ResendPasswordResetMailer(
      http,
      're_fake_key',
      'no-reply@mail.example.test',
    );

    await mailer.send({ to: 'a@example.test', language: 'ru', link });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_fake_key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: 'Praxis <no-reply@mail.example.test>',
      to: ['a@example.test'],
    });
    expect(body.subject).toMatch(/[А-Яа-я]/);
    expect(body.text).toContain(link);
    expect(body.html).toContain('lang="ru"');
  });

  it('fails with a content-free error on a non-2xx response', async () => {
    const { http } = recorder(422);
    const mailer = new ResendPasswordResetMailer(
      http,
      're_fake_key',
      'n@e.test',
    );

    const failure = await mailer
      .send({ to: 'a@example.test', language: 'en', link })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(ResendRequestError);
    const text = JSON.stringify([
      (failure as Error).message,
      (failure as Error).stack,
    ]);
    for (const secret of ['re_fake_key', 'a@example.test', 'oobCode']) {
      expect(text).not.toContain(secret);
    }
  });

  it('propagates transport failures', async () => {
    const mailer = new ResendPasswordResetMailer(
      () => Promise.reject(new TypeError('network')),
      're_fake_key',
      'n@e.test',
    );

    await expect(
      mailer.send({ to: 'a@example.test', language: 'en', link }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it.each([200, 500])(
    'cancels the response body (status %i)',
    async (status) => {
      let cancelled = false;
      const http: HttpClient = () =>
        Promise.resolve({
          ok: status < 400,
          status,
          body: {
            cancel: () => {
              cancelled = true;
              return Promise.resolve();
            },
          },
        } as unknown as Response);
      const mailer = new ResendPasswordResetMailer(http, 'k', 'n@e.test');

      await mailer
        .send({ to: 'a@example.test', language: 'en', link })
        .catch(() => undefined);

      expect(cancelled).toBe(true);
    },
  );
});
