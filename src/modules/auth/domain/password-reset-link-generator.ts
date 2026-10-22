/**
 * Port: asks the identity provider for a one-time password-reset action link.
 * Resolves to `null` when no account exists for the address. Any other
 * failure rejects.
 */
export interface PasswordResetLinkGenerator {
  generate(email: string): Promise<string | null>;
}
