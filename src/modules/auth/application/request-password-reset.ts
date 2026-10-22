import type { BackgroundRunner } from '../domain/background-runner';
import type { PasswordResetThrottle } from '../domain/password-reset-throttle';
import type { PasswordResetFailureReporter } from '../domain/password-reset-failure-reporter';
import type { PasswordResetLinkGenerator } from '../domain/password-reset-link-generator';
import type { PasswordResetMailer } from '../domain/password-reset-mailer';
import type { ResetLanguage } from '../domain/reset-language';

export interface RequestPasswordResetCommand {
  email: string;
  language: ResetLanguage;
}

class MalformedResetLink extends Error {}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}

function oobCodeOf(link: string): string {
  let code: string | null = null;
  try {
    code = new URL(link).searchParams.get('oobCode');
  } catch {
    // fall through to the malformed-link error; never include the link
  }
  if (!code) throw new MalformedResetLink('no oobCode');
  return code;
}

/**
 * Requests a password-reset email. Enumeration-safe by construction: the
 * request is answered before any work happens, and the work itself ends with
 * no outward effect whether or not the account exists, and whether or
 * not the link generator or mailer failed. Failures are reported by class
 * name only (never the address, link, oobCode or message).
 */
export class RequestPasswordReset {
  constructor(
    private readonly links: PasswordResetLinkGenerator,
    private readonly mailer: PasswordResetMailer,
    /** Trusted app origin from configuration; never from a request. */
    private readonly appOrigin: string,
    private readonly failures: PasswordResetFailureReporter,
    private readonly background: BackgroundRunner,
    private readonly throttle: PasswordResetThrottle,
  ) {}

  /**
   * Accepts the request and returns at once; all work (link generation,
   * mailing) runs in the background so the caller's latency cannot reveal
   * whether the account exists.
   */
  execute(command: RequestPasswordResetCommand): Promise<void> {
    this.background.run(() => this.process(command));
    return Promise.resolve();
  }

  private async process(command: RequestPasswordResetCommand): Promise<void> {
    if (!this.throttle.allow(command.email)) {
      this.failures.report('throttled', 'RateLimited');
      return;
    }

    let generated: string | null;
    try {
      generated = await this.links.generate(command.email);
    } catch (error) {
      this.failures.report('link-generation', errorName(error));
      return;
    }
    if (generated === null) return;

    let link: string;
    try {
      const params = new URLSearchParams({
        mode: 'resetPassword',
        oobCode: oobCodeOf(generated),
        lang: command.language,
      });
      link = `${this.appOrigin}/auth-action?${params.toString()}`;
    } catch (error) {
      this.failures.report('link-parsing', errorName(error));
      return;
    }

    try {
      await this.mailer.send({
        to: command.email,
        language: command.language,
        link,
      });
    } catch (error) {
      this.failures.report('mailing', errorName(error));
    }
  }
}
