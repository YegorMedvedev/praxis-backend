import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../platform/config/app-config';
import type { PurgeExpiredSessions } from '../application/purge-expired-sessions';
import { RETENTION_INTERVAL_MS, RetentionWorker } from './retention-worker';

const config = (env: string) =>
  ({ get: () => env }) as unknown as ConfigService<AppConfig, true>;
const idle = { sessions: 0, remoteSessionsQueued: 0, batches: 0 };

describe('RetentionWorker', () => {
  it('does not start under NODE_ENV=test', () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    const setTimeout = jest.spyOn(global, 'setTimeout');
    new RetentionWorker(
      { execute: jest.fn() } as unknown as PurgeExpiredSessions,
      config('test'),
    ).onApplicationBootstrap();
    expect(setInterval).not.toHaveBeenCalled();
    expect(setTimeout).not.toHaveBeenCalled();
    setInterval.mockRestore();
    setTimeout.mockRestore();
  });

  it('runs at least daily, with margin inside the 24 h allowance (NFR-1)', () => {
    expect(RETENTION_INTERVAL_MS).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
  });

  it('schedules a startup pass and a recurring pass, and stops on shutdown', async () => {
    jest.useFakeTimers();
    try {
      const execute = jest.fn().mockResolvedValue(idle);
      const worker = new RetentionWorker(
        { execute } as unknown as PurgeExpiredSessions,
        config('production'),
      );
      worker.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(11_000);
      expect(execute).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS);
      expect(execute).toHaveBeenCalledTimes(2);
      worker.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(RETENTION_INTERVAL_MS * 2);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never overlaps passes, survives failures and logs counts only', async () => {
    let release!: () => void;
    const execute = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({ sessions: 2, remoteSessionsQueued: 1, batches: 1 });
          }),
      )
      .mockRejectedValueOnce(new Error('MARKER-SECRET'))
      .mockResolvedValue(idle);
    const worker = new RetentionWorker(
      { execute } as unknown as PurgeExpiredSessions,
      config('production'),
    );
    const logger = (worker as unknown as { logger: Record<string, jest.Mock> })
      .logger;
    const log = jest.spyOn(logger as never, 'log').mockImplementation();
    const error = jest.spyOn(logger as never, 'error').mockImplementation();

    const first = worker.tick();
    await worker.tick();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await first;
    await worker.tick();
    await worker.tick();

    expect(execute).toHaveBeenCalledTimes(3);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      event: 'retention_purge',
      sessions: 2,
      remote_sessions_queued: 1,
      batches: 1,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('MARKER');
  });
});
