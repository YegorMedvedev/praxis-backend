import { Session } from '../domain/session';
import { PurgeExpiredSessions } from './purge-expired-sessions';
import {
  InMemoryDeletionQueue,
  InMemorySessionRepository,
  InMemoryUnitOfWork,
  RecordingCanceller,
} from './fakes';

const DAY = 24 * 60 * 60 * 1000;

describe('PurgeExpiredSessions', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  let sessions: InMemorySessionRepository;
  let queue: InMemoryDeletionQueue;
  let canceller: RecordingCanceller;

  const add = (id: string, ageDays: number, remote: string | null = null) => {
    const session = Session.start({
      id,
      userId: 'u1',
      caseId: `c-${id}`,
      language: 'en',
      agentId: 'agent',
      now: new Date(now.getTime() - ageDays * DAY),
    });
    if (remote) session.attachRemoteSession(remote);
    return sessions.insert(session);
  };
  const build = (batchSize = 200, maxBatches = 500) =>
    new PurgeExpiredSessions(
      sessions,
      queue,
      new InMemoryUnitOfWork([sessions, queue]),
      canceller,
      { now: () => now },
      batchSize,
      maxBatches,
    );

  beforeEach(() => {
    sessions = new InMemorySessionRepository();
    queue = new InMemoryDeletionQueue();
    canceller = new RecordingCanceller();
  });

  it('deletes sessions created 90 days ago or earlier and queues their remote ids (AC-18)', async () => {
    await add('old', 91, 'remote-old');
    await add('edge', 90, 'remote-edge');
    await add('young', 89.9, 'remote-young');
    await add('no-remote', 120);

    const result = await build().execute();

    expect(result).toEqual({
      sessions: 3,
      remoteSessionsQueued: 2,
      batches: 1,
    });
    expect([...sessions.sessions.keys()]).toEqual(['young']);
    expect([...queue.entries.keys()].sort()).toEqual([
      'remote-edge',
      'remote-old',
    ]);
    expect(canceller.cancelled.sort()).toEqual(['edge', 'no-remote', 'old']);
  });

  it('is idempotent: a second run finds nothing', async () => {
    await add('old', 91, 'remote-old');
    const purge = build();
    await purge.execute();

    await expect(purge.execute()).resolves.toEqual({
      sessions: 0,
      remoteSessionsQueued: 0,
      batches: 0,
    });
    expect(queue.entries.size).toBe(1);
  });

  it('works in batches and stops at the per-pass cap', async () => {
    for (let i = 0; i < 5; i++) await add(`s${i}`, 100 + i, `r${i}`);

    const capped = await build(2, 2).execute();
    expect(capped).toMatchObject({ sessions: 4, batches: 2 });
    expect(sessions.sessions.size).toBe(1);

    await expect(build(2, 2).execute()).resolves.toMatchObject({ sessions: 1 });
    expect(sessions.sessions.size).toBe(0);
    expect(queue.entries.size).toBe(5);
  });

  it('rolls a batch back whole when queueing fails', async () => {
    await add('old', 91, 'remote-old');
    jest.spyOn(queue, 'enqueue').mockRejectedValueOnce(new Error('db down'));

    await expect(build().execute()).rejects.toThrow('db down');

    expect(sessions.sessions.has('old')).toBe(true);
    expect(queue.entries.size).toBe(0);
    expect(canceller.cancelled).toEqual([]);
  });
});
