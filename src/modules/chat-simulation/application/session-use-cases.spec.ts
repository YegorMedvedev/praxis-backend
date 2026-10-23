import {
  CaseNotFoundError,
  SessionEndedError,
  SessionNotFoundError,
} from '../../../shared/domain-error';
import { Session } from '../domain/session';
import { CreateSession } from './create-session';
import { DiscardSession } from './discard-session';
import { EndSession } from './end-session';
import {
  InMemoryCaseAgentDirectory,
  InMemoryCompletionRecorder,
  InMemoryDeletionQueue,
  InMemorySessionRepository,
  InMemoryUnitOfWork,
  RecordingCanceller,
} from './fakes';
import { GetSession } from './get-session';

describe('session lifecycle use cases', () => {
  let now: Date;
  let nextId: number;
  let sessions: InMemorySessionRepository;
  let queue: InMemoryDeletionQueue;
  let completions: InMemoryCompletionRecorder;
  let agents: InMemoryCaseAgentDirectory;
  let canceller: RecordingCanceller;
  let create: CreateSession;
  let get: GetSession;
  let end: EndSession;
  let discard: DiscardSession;

  beforeEach(() => {
    now = new Date('2026-01-01T10:00:00.000Z');
    nextId = 0;
    sessions = new InMemorySessionRepository();
    queue = new InMemoryDeletionQueue();
    completions = new InMemoryCompletionRecorder();
    agents = new InMemoryCaseAgentDirectory();
    agents.set('case-1', 'en', 'agent-en');
    agents.set('case-1', 'ru', 'agent-ru');
    canceller = new RecordingCanceller();
    const clock = { now: () => now };
    const uow = new InMemoryUnitOfWork([sessions, queue, completions]);
    create = new CreateSession(
      sessions,
      agents,
      queue,
      uow,
      canceller,
      { next: () => `s${++nextId}` },
      clock,
    );
    get = new GetSession(sessions, clock);
    end = new EndSession(sessions, completions, uow, canceller, clock);
    discard = new DiscardSession(sessions, queue, uow, canceller, clock);
  });

  const start = (userId = 'u1', language: 'en' | 'ru' = 'ru') =>
    create.execute({ userId, caseId: 'case-1', language });

  describe('CreateSession', () => {
    it('creates an in-progress session with the resolved agent stored', async () => {
      const view = await start();

      expect(view).toEqual({
        id: 's1',
        caseId: 'case-1',
        language: 'ru',
        status: 'IN_PROGRESS',
        createdAt: now,
        endedAt: null,
        stats: {
          therapistMessageCount: 0,
          patientMessageCount: 0,
          durationSeconds: null,
          endedBy: null,
        },
      });
      expect(sessions.sessions.get('s1')?.agentId).toBe('agent-ru');
      expect(JSON.stringify(view)).not.toContain('agent');
    });

    it('rejects a case with no agent for the language and stores nothing', async () => {
      agents.set('case-2', 'en', 'agent-only-en');

      await expect(
        create.execute({ userId: 'u1', caseId: 'case-2', language: 'ru' }),
      ).rejects.toThrow(CaseNotFoundError);
      await expect(
        create.execute({ userId: 'u1', caseId: 'nope', language: 'en' }),
      ).rejects.toThrow(CaseNotFoundError);
      expect(sessions.sessions.size).toBe(0);
    });

    it('discards every other session of the user for the case, in any status', async () => {
      await start();
      await end.execute('u1', 's1');
      await start('u1', 'en');
      const other = await start('u2');

      const fresh = await start('u1');

      await expect(get.execute('u1', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
      await expect(get.execute('u1', 's2')).rejects.toThrow(
        SessionNotFoundError,
      );
      expect((await get.execute('u1', fresh.id)).status).toBe('IN_PROGRESS');
      expect((await get.execute('u2', other.id)).status).toBe('IN_PROGRESS');
      // The completion of the replaced ended session stays.
      expect(completions.has('u1', 'case-1')).toBe(true);
    });

    it('queues the remote session of a replaced session and cancels its reply', async () => {
      await start();
      const first = sessions.sessions.get('s1')!;
      sessions.sessions.set(
        's1',
        Session.restore({ ...first.snapshot(), openaiSessionId: 'remote-1' }),
      );

      await start();

      expect([...queue.entries.keys()]).toEqual(['remote-1']);
      expect(canceller.cancelled).toEqual(['s1']);
    });

    it('queues nothing for a replaced session without a remote session', async () => {
      await start();
      await start();
      expect(queue.entries.size).toBe(0);
    });
  });

  describe('GetSession', () => {
    it('treats another user session as not found', async () => {
      const view = await start('u1');
      await expect(get.execute('u2', view.id)).rejects.toThrow(
        SessionNotFoundError,
      );
      await expect(get.execute('u1', 'unknown')).rejects.toThrow(
        SessionNotFoundError,
      );
    });
  });

  describe('EndSession', () => {
    it('ends the session, completes the case, and reports stats', async () => {
      await start();
      sessions.setMessageCounts('s1', 3, 3);
      now = new Date(now.getTime() + 125_700);

      const view = await end.execute('u1', 's1');

      expect(view.status).toBe('ENDED_BY_THERAPIST');
      expect(view.endedAt).toEqual(now);
      expect(view.stats).toEqual({
        therapistMessageCount: 3,
        patientMessageCount: 3,
        durationSeconds: 125,
        endedBy: 'THERAPIST',
      });
      expect(completions.has('u1', 'case-1')).toBe(true);
      expect(canceller.cancelled).toEqual(['s1']);
    });

    it('is idempotent: a repeat returns an identical body and ends nothing again', async () => {
      await start();
      now = new Date(now.getTime() + 5000);
      const first = await end.execute('u1', 's1');
      now = new Date(now.getTime() + 60_000);

      const second = await end.execute('u1', 's1');

      expect(second).toEqual(first);
      expect(await get.execute('u1', 's1')).toEqual(first);
      expect(canceller.cancelled).toEqual(['s1']);
    });

    it('rolls the end back when the completion fails (atomic, AC-13)', async () => {
      await start();
      completions.failWith = new Error('db down');

      await expect(end.execute('u1', 's1')).rejects.toThrow('db down');

      expect((await get.execute('u1', 's1')).status).toBe('IN_PROGRESS');
      expect(completions.has('u1', 'case-1')).toBe(false);
      expect(canceller.cancelled).toEqual([]);
    });

    it('answers session-ended for a session ended by the patient', async () => {
      await start();
      const stored = sessions.sessions.get('s1')!;
      sessions.sessions.set(
        's1',
        Session.restore({
          ...stored.snapshot(),
          status: 'ENDED_BY_PATIENT',
          endedAt: now,
        }),
      );

      await expect(end.execute('u1', 's1')).rejects.toThrow(SessionEndedError);
    });

    it('treats a foreign or unknown id as not found', async () => {
      await start('u1');
      await expect(end.execute('u2', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
      expect(completions.completed.size).toBe(0);
    });
  });

  describe('DiscardSession', () => {
    it('removes an in-progress session without completing the case', async () => {
      await start();

      await discard.execute('u1', 's1');

      await expect(get.execute('u1', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
      expect(completions.completed.size).toBe(0);
      expect(canceller.cancelled).toEqual(['s1']);
    });

    it('keeps the completion of an ended session', async () => {
      await start();
      await end.execute('u1', 's1');
      await discard.execute('u1', 's1');
      expect(completions.has('u1', 'case-1')).toBe(true);
    });

    it('is silent for repeats and for another user id', async () => {
      await start('u1');
      await expect(discard.execute('u2', 's1')).resolves.toBeUndefined();
      expect(sessions.sessions.has('s1')).toBe(true);
      await discard.execute('u1', 's1');
      await expect(discard.execute('u1', 's1')).resolves.toBeUndefined();
    });

    it('queues the remote session in the same unit of work', async () => {
      await start();
      const stored = sessions.sessions.get('s1')!;
      sessions.sessions.set(
        's1',
        Session.restore({ ...stored.snapshot(), openaiSessionId: 'remote-9' }),
      );

      await discard.execute('u1', 's1');

      expect([...queue.entries.keys()]).toEqual(['remote-9']);
    });
  });

  describe('retention expiry (05 FR-6, AC-6)', () => {
    it('answers not found once 90 days have passed since creation, for GET and PATCH', async () => {
      await start();
      now = new Date('2026-03-31T09:59:59.000Z'); // 89 d 23 h 59 m 59 s
      await expect(get.execute('u1', 's1')).resolves.toBeDefined();

      now = new Date('2026-04-01T10:00:00.000Z'); // exactly 90 days
      await expect(get.execute('u1', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
      await expect(end.execute('u1', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
      expect(completions.has('u1', 'case-1')).toBe(false);
    });

    it('runs from creation, not from the end of the session', async () => {
      await start();
      now = new Date('2026-03-30T10:00:00.000Z');
      await end.execute('u1', 's1');
      now = new Date('2026-04-01T10:00:00.000Z');
      await expect(get.execute('u1', 's1')).rejects.toThrow(
        SessionNotFoundError,
      );
    });
  });
});
