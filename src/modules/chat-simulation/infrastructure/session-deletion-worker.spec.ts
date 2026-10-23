import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../platform/config/app-config';
import type { ProcessSessionDeletions } from '../application/process-session-deletions';
import { SessionDeletionWorker } from './session-deletion-worker';

const config = (env: string) =>
  ({ get: () => env }) as unknown as ConfigService<AppConfig, true>;

describe('SessionDeletionWorker', () => {
  it('does not start its timer under NODE_ENV=test', () => {
    const setInterval = jest.spyOn(global, 'setInterval');
    const worker = new SessionDeletionWorker(
      { execute: jest.fn() } as unknown as ProcessSessionDeletions,
      config('test'),
    );

    worker.onApplicationBootstrap();

    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it('never overlaps passes and survives a failing pass', async () => {
    const idle = { due: 0, deleted: 0, failed: 0 };
    let release!: () => void;
    const execute = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve(idle))),
      )
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(idle);
    const worker = new SessionDeletionWorker(
      { execute } as unknown as ProcessSessionDeletions,
      config('production'),
    );
    const error = jest
      .spyOn(
        (worker as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    const first = worker.tick();
    await worker.tick();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await first;

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('boom');
    await worker.tick();
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
