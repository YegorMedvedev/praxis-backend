import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../platform/config/app-config';
import { PurgeExpiredSessions } from '../application/purge-expired-sessions';

/**
 * NFR-1 (05): no transcript older than 90 days + 24 hours. A session expires
 * at `created_at + 90 d`, so it is removed by the first pass after that
 * instant, at most one interval (+ the pass duration) later. With a 6 hour
 * interval that is far inside the 24 hour allowance, and the margin absorbs a
 * skipped pass or a slow batch. The first pass runs shortly after boot so a
 * restart never resets the clock (a bare `setInterval` would). Reads already
 * treat expired sessions as gone (`Session.isExpired`), so the delay is
 * invisible to the API.
 */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RETENTION_STARTUP_DELAY_MS = 10_000;

/**
 * In-process background worker (same single-instance model as
 * `SessionDeletionWorker`). Never started under `NODE_ENV=test`, so tests
 * drive `tick()` themselves. A pass in progress is never overlapped, and a
 * failing pass only logs the error class. Logs carry counts only.
 */
@Injectable()
export class RetentionWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RetentionWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private startup: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly purge: PurgeExpiredSessions,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.startup = setTimeout(
      () => void this.tick(),
      RETENTION_STARTUP_DELAY_MS,
    );
    this.startup.unref();
    this.timer = setInterval(() => void this.tick(), RETENTION_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startup) clearTimeout(this.startup);
    this.timer = undefined;
    this.startup = undefined;
  }

  /** One pass; resolves when done. Skipped while another pass is running. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.purge.execute();
      if (result.sessions > 0) {
        this.logger.log(
          JSON.stringify({
            event: 'retention_purge',
            sessions: result.sessions,
            remote_sessions_queued: result.remoteSessionsQueued,
            batches: result.batches,
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'retention_purge_failed',
          error:
            error instanceof Error ? error.constructor.name : 'UnknownError',
        }),
      );
    } finally {
      this.running = false;
    }
  }
}
