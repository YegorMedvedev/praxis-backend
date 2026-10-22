import type { BackgroundRunner } from '../domain/background-runner';
import type { PasswordResetThrottle } from '../domain/password-reset-throttle';
import type { PasswordResetFailureReporter } from '../domain/password-reset-failure-reporter';
import type { PasswordResetLinkGenerator } from '../domain/password-reset-link-generator';
import type {
  PasswordResetMail,
  PasswordResetMailer,
} from '../domain/password-reset-mailer';

/** Knows a fixed set of addresses; returns a Firebase-shaped link for them. */
export class FakePasswordResetLinkGenerator implements PasswordResetLinkGenerator {
  readonly requested: string[] = [];
  failWith?: Error;

  constructor(
    private readonly known: ReadonlySet<string> = new Set(),
    private readonly linkFor: (email: string) => string = (email) =>
      `https://project.firebaseapp.test/__/auth/action?mode=resetPassword&oobCode=code-for-${email}&apiKey=k&lang=en`,
  ) {}

  generate(email: string): Promise<string | null> {
    this.requested.push(email);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(this.known.has(email) ? this.linkFor(email) : null);
  }
}

/** Records mails instead of sending them. Exported for tests. */
export class InMemoryPasswordResetMailer implements PasswordResetMailer {
  readonly sent: PasswordResetMail[] = [];
  failWith?: Error;

  send(mail: PasswordResetMail): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(mail);
    return Promise.resolve();
  }
}

export class RecordingFailureReporter implements PasswordResetFailureReporter {
  readonly reports: Array<{ stage: string; errorName: string }> = [];

  report(stage: string, errorName: string): void {
    this.reports.push({ stage, errorName });
  }
}

/** Runs tasks right away but tracks them so tests can await completion. */
export class TrackingBackgroundRunner implements BackgroundRunner {
  private readonly pending = new Set<Promise<void>>();

  run(task: () => Promise<void>): void {
    const promise = Promise.resolve()
      .then(task)
      .catch(() => undefined)
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }
}

/** Allows `limit` requests per address, then refuses. */
export class CountingThrottle implements PasswordResetThrottle {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit = Infinity) {}

  allow(email: string): boolean {
    const key = email.toLowerCase();
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next <= this.limit;
  }
}
