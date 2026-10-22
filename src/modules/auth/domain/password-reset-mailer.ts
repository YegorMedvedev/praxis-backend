import type { ResetLanguage } from './reset-language';

export interface PasswordResetMail {
  to: string;
  language: ResetLanguage;
  /** The single app link the email carries. */
  link: string;
}

/** Port: sends the localized, branded reset email. Rejects on failure. */
export interface PasswordResetMailer {
  send(mail: PasswordResetMail): Promise<void>;
}
