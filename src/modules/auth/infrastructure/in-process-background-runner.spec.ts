import { RecordingFailureReporter } from '../application/fakes';
import { InProcessBackgroundRunner } from './in-process-background-runner';

describe('InProcessBackgroundRunner', () => {
  it('returns before the task finishes and completes it later', async () => {
    const runner = new InProcessBackgroundRunner(
      new RecordingFailureReporter(),
    );
    let done = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    runner.run(async () => {
      await gate;
      done = true;
    });
    expect(done).toBe(false);

    release();
    await runner.idle();
    expect(done).toBe(true);
  });

  it('swallows a failing task and reports only its class name', async () => {
    const failures = new RecordingFailureReporter();
    const runner = new InProcessBackgroundRunner(failures);
    class Kaboom extends Error {}

    runner.run(() => Promise.reject(new Kaboom('secret@example.test')));
    runner.run(() => {
      throw new Kaboom('sync');
    });

    await expect(runner.idle()).resolves.toBeUndefined();
    expect(failures.reports).toEqual([
      { stage: 'mailing', errorName: 'Kaboom' },
      { stage: 'mailing', errorName: 'Kaboom' },
    ]);
  });

  it('drops work beyond the bound instead of queueing without limit', async () => {
    const failures = new RecordingFailureReporter();
    const runner = new InProcessBackgroundRunner(failures, 2);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ran = 0;
    const task = async () => {
      await gate;
      ran += 1;
    };

    runner.run(task);
    runner.run(task);
    runner.run(task);
    release();
    await runner.idle();

    expect(ran).toBe(2);
    expect(failures.reports).toEqual([
      { stage: 'dropped', errorName: 'QueueFull' },
    ]);
  });
});
