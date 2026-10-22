import { buildPasswordResetEmail } from './password-reset-email';

const link =
  'https://app.example.test/auth-action?mode=resetPassword&oobCode=abc123&lang=en';

describe('buildPasswordResetEmail', () => {
  it.each(['en', 'ru'] as const)(
    'carries exactly one link and the 60 minute lifetime (%s)',
    (language) => {
      const email = buildPasswordResetEmail({ language, link });

      expect(email.subject).toContain('Praxis');
      expect(email.text.split(link)).toHaveLength(2);
      expect(email.html.match(/href="/g)).toHaveLength(1);
      expect(email.html).toContain(
        'href="https://app.example.test/auth-action?mode=resetPassword&amp;oobCode=abc123&amp;lang=en"',
      );
      expect(email.text).toContain('60');
      expect(email.html).toContain('60');
    },
  );

  it('is clearly placeholder copy', () => {
    expect(buildPasswordResetEmail({ language: 'en', link }).text).toContain(
      'PLACEHOLDER',
    );
    expect(buildPasswordResetEmail({ language: 'ru', link }).text).toContain(
      'PLACEHOLDER',
    );
  });

  it('renders Russian in Cyrillic that survives a UTF-8 round trip', () => {
    const email = buildPasswordResetEmail({ language: 'ru', link });

    expect(email.subject).toMatch(/[А-Яа-я]/);
    for (const part of [email.subject, email.text, email.html]) {
      expect(Buffer.from(part, 'utf8').toString('utf8')).toBe(part);
      expect(part).not.toContain('�');
    }
    expect(email.html).toContain('<meta charset="utf-8">');
  });

  it('escapes the link so it cannot break out of the attribute or markup', () => {
    const email = buildPasswordResetEmail({
      language: 'en',
      link: 'https://a.test/x?"><script>alert(1)</script>',
    });

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('x?&quot;&gt;&lt;script&gt;');
  });

  it('never mentions a password value or personal data', () => {
    const email = buildPasswordResetEmail({ language: 'en', link });
    expect(email.text).not.toMatch(/your password is/i);
  });
});
