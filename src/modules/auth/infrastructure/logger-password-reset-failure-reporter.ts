import { Logger } from '@nestjs/common';
import type {
  PasswordResetFailureReporter,
  PasswordResetStage,
} from '../domain/password-reset-failure-reporter';

/** Logs the stage and error class name only; the arguments hold nothing else. */
export class LoggerPasswordResetFailureReporter implements PasswordResetFailureReporter {
  private readonly logger = new Logger('PasswordReset');

  report(stage: PasswordResetStage, errorName: string): void {
    this.logger.warn(
      JSON.stringify({
        event: 'password_reset_failed',
        stage,
        error: errorName,
      }),
    );
  }
}
