import { buildPasswordResetEmail } from '../domain/password-reset-email';
import type {
  PasswordResetMail,
  PasswordResetMailer,
} from '../domain/password-reset-mailer';

/** A `fetch`-compatible client; injected so tests never reach Resend. */
export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Carries nothing but the status class: no body, address, link or key. */
export class ResendRequestError extends Error {
  constructor(readonly status: number) {
    super(`Resend rejected the request (HTTP ${status})`);
  }
}

/** Sends the reset email through the Resend HTTP API. Never logs anything. */
export class ResendPasswordResetMailer implements PasswordResetMailer {
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(mail: PasswordResetMail): Promise<void> {
    const content = buildPasswordResetEmail({
      language: mail.language,
      link: mail.link,
    });
    const response = await this.http(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Praxis <${this.fromAddress}>`,
        to: [mail.to],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Release the connection without reading (or keeping) the body.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new ResendRequestError(response.status);
  }
}
