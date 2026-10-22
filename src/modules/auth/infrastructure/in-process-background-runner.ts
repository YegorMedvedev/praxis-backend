import type { BackgroundRunner } from '../domain/background-runner';
import type { PasswordResetFailureReporter } from '../domain/password-reset-failure-reporter';

/**
 * Fire-and-forget runner held in process memory. Work in flight is lost on a
 * crash or restart (accepted: a user can simply request again). At most
 * `maxPending` tasks run at once; more are dropped and reported.
 */
export class InProcessBackgroundRunner implements BackgroundRunner {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly failures: PasswordResetFailureReporter,
    private readonly maxPending = 100,
  ) {}

  run(task: () => Promise<void>): void {
    if (this.pending.size >= this.maxPending) {
      this.failures.report('dropped', 'QueueFull');
      return;
    }
    const promise: Promise<void> = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        this.failures.report(
          'mailing',
          error instanceof Error ? error.constructor.name : 'UnknownError',
        );
      })
      .finally(() => {
        this.pending.delete(promise);
      });
    this.pending.add(promise);
  }

  /** Resolves when everything started so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }
}
