import { FakeRemoteSessionRemover, InMemoryDeletionQueue } from './fakes';
import { ProcessSessionDeletions } from './process-session-deletions';

describe('ProcessSessionDeletions', () => {
  let now: Date;
  let queue: InMemoryDeletionQueue;
  let remover: FakeRemoteSessionRemover;
  let worker: ProcessSessionDeletions;

  beforeEach(() => {
    now = new Date('2026-01-01T10:00:00.000Z');
    queue = new InMemoryDeletionQueue();
    remover = new FakeRemoteSessionRemover();
    worker = new ProcessSessionDeletions(queue, remover, { now: () => now });
  });

  it('deletes a due remote session and removes its queue row', async () => {
    await queue.enqueue('r1', now);

    await expect(worker.execute()).resolves.toEqual({
      due: 1,
      deleted: 1,
      failed: 0,
    });

    expect(remover.removed).toEqual(['r1']);
    expect(queue.entries.size).toBe(0);
  });

  it('retries a failing deletion with backoff until it succeeds (AC-16)', async () => {
    await queue.enqueue('r1', now);
    remover.failures = 2;

    await expect(worker.execute()).resolves.toMatchObject({ failed: 1 });
    expect(queue.entries.get('r1')).toEqual({
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 30_000),
    });

    // Not due yet: nothing is attempted.
    await expect(worker.execute()).resolves.toMatchObject({ due: 0 });
    expect(remover.calls).toHaveLength(1);

    now = new Date(now.getTime() + 30_000);
    await expect(worker.execute()).resolves.toMatchObject({ failed: 1 });
    expect(queue.entries.get('r1')?.attempts).toBe(2);

    now = new Date(now.getTime() + 60_000);
    await expect(worker.execute()).resolves.toMatchObject({ deleted: 1 });
    expect(queue.entries.size).toBe(0);
    expect(remover.removed).toEqual(['r1']);
  });

  it('one failing entry does not block the others', async () => {
    await queue.enqueue('r1', now);
    await queue.enqueue('r2', now);
    remover.failures = 1;

    await expect(worker.execute()).resolves.toEqual({
      due: 2,
      deleted: 1,
      failed: 1,
    });
    expect([...queue.entries.keys()]).toEqual(['r1']);
  });

  it('is safe to run twice and with an empty queue', async () => {
    await expect(worker.execute()).resolves.toEqual({
      due: 0,
      deleted: 0,
      failed: 0,
    });
    await queue.enqueue('r1', now);
    await worker.execute();
    await expect(worker.execute()).resolves.toMatchObject({ due: 0 });
  });
});
