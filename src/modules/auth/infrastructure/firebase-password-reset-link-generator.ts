import type { PasswordResetLinkGenerator } from '../domain/password-reset-link-generator';

/** The slice of the Firebase Admin `Auth` this adapter uses. */
export interface PasswordResetLinkClient {
  generatePasswordResetLink(email: string): Promise<string>;
}

const NO_SUCH_USER = new Set(['auth/user-not-found', 'auth/email-not-found']);

/**
 * Asks Firebase for a reset action link (it carries the one-time `oobCode`).
 * Firebase does not send anything itself here; the mail goes through Resend.
 */
export class FirebasePasswordResetLinkGenerator implements PasswordResetLinkGenerator {
  constructor(private readonly auth: PasswordResetLinkClient) {}

  async generate(email: string): Promise<string | null> {
    try {
      return await this.auth.generatePasswordResetLink(email);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && NO_SUCH_USER.has(code)) return null;
      throw error;
    }
  }
}
