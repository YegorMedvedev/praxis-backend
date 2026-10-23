import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../platform/config/app-config';
import { ProcessSessionDeletions } from '../application/process-session-deletions';

export const SESSION_DELETION_INTERVAL_MS = 30_000;

/**
 * In-process background worker (same single-instance model as the password
 * reset runner): periodically deletes queued remote sessions. Never started
 * under `NODE_ENV=test`, so unit and e2e tests drive `tick()` themselves.
 * A pass in progress is never overlapped, and a failing pass only logs the
 * error class. Logs carry counts only, never remote ids.
 */
@Injectable()
export class SessionDeletionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SessionDeletionWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly processor: ProcessSessionDeletions,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(
      () => void this.tick(),
      SESSION_DELETION_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass; resolves when done. Skipped while another pass is running. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.processor.execute();
      if (result.due > 0) {
        this.logger.log(
          JSON.stringify({ event: 'remote_session_deletions', ...result }),
        );
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'remote_session_deletions_failed',
          error:
            error instanceof Error ? error.constructor.name : 'UnknownError',
        }),
      );
    } finally {
      this.running = false;
    }
  }
}
