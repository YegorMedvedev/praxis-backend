import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { RecordCaseCompletion } from '../../src/modules/case-library/application/record-case-completion';
import { CaseCompletionOrmEntity } from '../../src/modules/case-library/infrastructure/persistence/case-completion.orm-entity';
import { TypeOrmCaseCompletionRepository } from '../../src/modules/case-library/infrastructure/persistence/typeorm-case-completion.repository';
import { FakePatientReplyGenerator } from '../../src/modules/chat-simulation/application/fakes';
import { GenerationRegistry } from '../../src/modules/chat-simulation/application/generation-registry';
import { SendTherapistMessage } from '../../src/modules/chat-simulation/application/send-therapist-message';
import { StreamPatientReply } from '../../src/modules/chat-simulation/application/stream-patient-reply';
import { ReplyPendingError } from '../../src/shared/domain-error';
import { activeManager } from '../../src/platform/database/transaction-context';
import { MessageOrmEntity } from '../../src/modules/chat-simulation/infrastructure/persistence/message.orm-entity';
import { TypeOrmMessageRepository } from '../../src/modules/chat-simulation/infrastructure/persistence/typeorm-message.repository';
import { CreateSession } from '../../src/modules/chat-simulation/application/create-session';
import { DiscardSession } from '../../src/modules/chat-simulation/application/discard-session';
import { EndSession } from '../../src/modules/chat-simulation/application/end-session';
import { PurgeExpiredSessions } from '../../src/modules/chat-simulation/application/purge-expired-sessions';
import { GetSession } from '../../src/modules/chat-simulation/application/get-session';
import { Session } from '../../src/modules/chat-simulation/domain/session';
import { AgentSessionDeletionOrmEntity } from '../../src/modules/chat-simulation/infrastructure/persistence/agent-session-deletion.orm-entity';
import { SessionOrmEntity } from '../../src/modules/chat-simulation/infrastructure/persistence/session.orm-entity';
import { TypeOrmSessionDeletionQueue } from '../../src/modules/chat-simulation/infrastructure/persistence/typeorm-session-deletion-queue';
import { TypeOrmSessionRepository } from '../../src/modules/chat-simulation/infrastructure/persistence/typeorm-session.repository';
import { TypeOrmUnitOfWork } from '../../src/modules/chat-simulation/infrastructure/persistence/typeorm-unit-of-work';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';
import { AddCaseTranslationAgentId1760000002000 } from '../../src/platform/database/migrations/1760000002000-AddCaseTranslationAgentId';
import { CreateChatSimulation1760000003000 } from '../../src/platform/database/migrations/1760000003000-CreateChatSimulation';

const t0 = new Date('2026-01-01T10:00:00.000Z');

describe('Chat simulation repositories and unit of work (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let sessions: TypeOrmSessionRepository;
  let queue: TypeOrmSessionDeletionQueue;
  let uow: TypeOrmUnitOfWork;
  let completionRepo: TypeOrmCaseCompletionRepository;
  let messages: TypeOrmMessageRepository;
  let registry: GenerationRegistry;
  let generator: FakePatientReplyGenerator;
  let send: SendTherapistMessage;
  let stream: StreamPatientReply;
  let now: Date;
  let nextId: number;
  let failRecording: boolean;

  let create: CreateSession;
  let get: GetSession;
  let end: EndSession;
  let discard: DiscardSession;
  let purge: PurgeExpiredSessions;

  const sql = <T = any>(query: string, params: unknown[] = []): Promise<T> =>
    dataSource.query(query, params);
  const count = async (query: string, params: unknown[] = []) =>
    Number((await sql<{ count: string }[]>(query, params))[0].count);

  const fresh = (id: string, userId = 'u1', caseId = 'c1'): Session =>
    Session.start({
      id,
      userId,
      caseId,
      language: 'en',
      agentId: 'agent-1',
      now: t0,
    });

  const addMessage = (sessionId: string, role: 'THERAPIST' | 'PATIENT') =>
    sql(
      `INSERT INTO chat_simulation.messages (id, session_id, role, text, created_at)
       VALUES ($1, $2, $3, 'marker text', now())`,
      [`m-${Math.random()}`, sessionId, role],
    );

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    dataSource = await new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [
        SessionOrmEntity,
        MessageOrmEntity,
        AgentSessionDeletionOrmEntity,
        CaseCompletionOrmEntity,
      ],
      migrations: [
        CreateCaseLibrary1760000001000,
        AddCaseTranslationAgentId1760000002000,
        CreateChatSimulation1760000003000,
      ],
      synchronize: false,
    }).initialize();
    await dataSource.runMigrations();

    sessions = new TypeOrmSessionRepository(
      dataSource.getRepository(SessionOrmEntity),
    );
    queue = new TypeOrmSessionDeletionQueue(
      dataSource.getRepository(AgentSessionDeletionOrmEntity),
    );
    uow = new TypeOrmUnitOfWork(dataSource);
    completionRepo = new TypeOrmCaseCompletionRepository(
      dataSource.getRepository(CaseCompletionOrmEntity),
    );
    const clock = { now: () => now };
    const record = new RecordCaseCompletion(completionRepo, clock);
    const completions = {
      record: async (userId: string, caseId: string) => {
        await record.execute({ userId, caseId });
        // Injected failure between the session write and the commit.
        if (failRecording) throw new Error('injected failure');
      },
    };
    const agents = { findAgentId: () => Promise.resolve('agent-1') };
    registry = new GenerationRegistry();
    const canceller = registry;
    messages = new TypeOrmMessageRepository(
      dataSource.getRepository(MessageOrmEntity),
    );
    generator = new FakePatientReplyGenerator();
    const ids = { next: () => `g${++nextId}-${Math.random()}` };
    send = new SendTherapistMessage(sessions, messages, uow, ids, clock);
    stream = new StreamPatientReply(
      sessions,
      messages,
      generator,
      registry,
      queue,
      uow,
      ids,
      clock,
      { idleTimeoutMs: 200, keepAliveMs: 500 },
    );
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
    purge = new PurgeExpiredSessions(
      sessions,
      queue,
      uow,
      canceller,
      clock,
      2,
      100,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await sql('DELETE FROM chat_simulation.sessions');
    await sql('DELETE FROM chat_simulation.agent_session_deletions');
    await sql('DELETE FROM case_library.case_completions');
    now = t0;
    nextId = 0;
    failRecording = false;
  });

  describe('sessions', () => {
    it('round-trips a session with defaults for the server-side fields', async () => {
      await sessions.insert(fresh('a'));

      const found = await sessions.findOwnedWithStats('a', 'u1');

      expect(found?.session.snapshot()).toEqual({
        id: 'a',
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
        status: 'IN_PROGRESS',
        createdAt: t0,
        endedAt: null,
        agentId: 'agent-1',
        openaiSessionId: null,
        remoteInSync: true,
      });
    });

    it('counts stored messages per role', async () => {
      await sessions.insert(fresh('a'));
      for (const role of ['THERAPIST', 'THERAPIST', 'PATIENT'] as const) {
        await addMessage('a', role);
      }

      const found = await sessions.findOwnedWithStats('a', 'u1');

      expect(found).toMatchObject({
        therapistMessageCount: 2,
        patientMessageCount: 1,
      });
    });

    it('never returns another user session, or an id the column cannot hold', async () => {
      await sessions.insert(fresh('a'));
      await expect(sessions.findOwnedWithStats('a', 'u2')).resolves.toBeNull();
      await expect(
        uow.run(() => sessions.lockOwned('a', 'u2')),
      ).resolves.toBeNull();
      await expect(sessions.deleteOwned('a', 'u2')).resolves.toBeNull();
      for (const id of ['', 'x'.repeat(129), 'a\u0000b']) {
        await expect(sessions.findOwnedWithStats(id, 'u1')).resolves.toBeNull();
        await expect(sessions.deleteOwned(id, 'u1')).resolves.toBeNull();
      }
      expect(await count('SELECT count(*) FROM chat_simulation.sessions')).toBe(
        1,
      );
    });

    it('persists the end state and the remote attributes', async () => {
      const session = fresh('a');
      await sessions.insert(session);
      session.endByTherapist(new Date(t0.getTime() + 2000));
      await sessions.save(session);

      const found = await sessions.findOwnedWithStats('a', 'u1');

      expect(found?.session.status).toBe('ENDED_BY_THERAPIST');
      expect(found?.session.endedAt).toEqual(new Date(t0.getTime() + 2000));
    });

    it('deletes the session with its messages and reports the remote id', async () => {
      await sessions.insert(fresh('a'));
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-a' WHERE id = 'a'`,
      );
      await addMessage('a', 'THERAPIST');

      const removed = await sessions.deleteOwned('a', 'u1');

      expect(removed).toEqual({ id: 'a', openaiSessionId: 'remote-a' });
      expect(await count('SELECT count(*) FROM chat_simulation.messages')).toBe(
        0,
      );
      await expect(sessions.deleteOwned('a', 'u1')).resolves.toBeNull();
    });

    it('allows one session per user and case at the database level', async () => {
      await sessions.insert(fresh('a'));
      await expect(sessions.insert(fresh('b'))).rejects.toThrow();
      await sessions.insert(fresh('c', 'u1', 'c2'));
      await sessions.insert(fresh('d', 'u2', 'c1'));
    });

    it('refuses an inconsistent ended_at at the database level', async () => {
      await sessions.insert(fresh('a'));
      await expect(
        sql(
          `UPDATE chat_simulation.sessions SET status = 'ENDED_BY_THERAPIST' WHERE id = 'a'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('deletion queue', () => {
    it('enqueues idempotently and lists only due entries by time', async () => {
      await queue.enqueue('r1', t0);
      await queue.enqueue('r1', new Date(t0.getTime() + 999_999));
      await queue.enqueue('r2', new Date(t0.getTime() + 60_000));

      expect(await queue.findDue(t0, 10)).toEqual([
        { openaiSessionId: 'r1', attempts: 0 },
      ]);
      expect(
        await queue.findDue(new Date(t0.getTime() + 60_000), 10),
      ).toHaveLength(2);
    });

    it('reschedules and completes', async () => {
      await queue.enqueue('r1', t0);
      const later = new Date(t0.getTime() + 30_000);
      await queue.reschedule('r1', 1, later);

      expect(await queue.findDue(t0, 10)).toEqual([]);
      expect(await queue.findDue(later, 10)).toEqual([
        { openaiSessionId: 'r1', attempts: 1 },
      ]);

      await queue.complete('r1');
      expect(await queue.findDue(later, 10)).toEqual([]);
    });
  });

  describe('lifecycle in one transaction', () => {
    const completed = () =>
      count(`SELECT count(*) FROM case_library.case_completions`);

    it('ending marks the case completed in the same commit', async () => {
      const { id } = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
      });
      now = new Date(t0.getTime() + 125_700);

      const view = await end.execute('u1', id);

      expect(view.stats.durationSeconds).toBe(125);
      expect(await completed()).toBe(1);
    });

    it('a failure after the completion write rolls both back (AC-13)', async () => {
      const { id } = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
      });
      failRecording = true;

      await expect(end.execute('u1', id)).rejects.toThrow('injected failure');

      expect((await get.execute('u1', id)).status).toBe('IN_PROGRESS');
      expect(await completed()).toBe(0);
    });

    it('concurrent ends all succeed with one identical body and one completion', async () => {
      const { id } = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => end.execute('u1', id)),
      );

      expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(results[0].status).toBe('ENDED_BY_THERAPIST');
      expect(await completed()).toBe(1);
    });

    it('creating replaces the old session, queues its remote id in the same commit, keeps the completion', async () => {
      const first = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
      });
      await end.execute('u1', first.id);
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-1' WHERE id = $1`,
        [first.id],
      );

      const second = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'ru',
      });

      await expect(get.execute('u1', first.id)).rejects.toThrow();
      expect((await get.execute('u1', second.id)).status).toBe('IN_PROGRESS');
      expect(
        (await queue.findDue(new Date(t0.getTime() + 1), 10)).map(
          (e) => e.openaiSessionId,
        ),
      ).toEqual(['remote-1']);
      expect(await completed()).toBe(1);
    });

    it('concurrent creates for the same user and case leave exactly one session', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          create.execute({ userId: 'u1', caseId: 'c1', language: 'en' }),
        ),
      );

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await count('SELECT count(*) FROM chat_simulation.sessions')).toBe(
        1,
      );
    });

    it('discarding queues the remote id, removes the transcript and does not complete the case', async () => {
      const { id } = await create.execute({
        userId: 'u1',
        caseId: 'c1',
        language: 'en',
      });
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-2' WHERE id = $1`,
        [id],
      );
      await addMessage(id, 'PATIENT');

      await discard.execute('u1', id);

      expect(await count('SELECT count(*) FROM chat_simulation.sessions')).toBe(
        0,
      );
      expect(await count('SELECT count(*) FROM chat_simulation.messages')).toBe(
        0,
      );
      expect(
        await count(
          'SELECT count(*) FROM chat_simulation.agent_session_deletions',
        ),
      ).toBe(1);
      expect(await completed()).toBe(0);
    });
  });
  describe('messages and patient replies', () => {
    const start = async (userId = 'u1') =>
      (await create.execute({ userId, caseId: 'c1', language: 'en' })).id;
    const run = async (userId: string, id: string) => {
      const events: { type: string }[] = [];
      for await (const event of (await stream.execute(userId, id)).events) {
        events.push(event);
      }
      return events;
    };
    const roles = async (id: string) =>
      (await messages.listBySession(id)).map((m) => m.role);
    const remoteState = async (id: string) =>
      (
        await sql<
          { openai_session_id: string | null; remote_in_sync: boolean }[]
        >(
          'SELECT openai_session_id, remote_in_sync FROM chat_simulation.sessions WHERE id = $1',
          [id],
        )
      )[0];

    it('lists messages in the order they were stored, even when timestamps tie or go backwards', async () => {
      const id = await start();
      const at = (ms: number) => new Date(t0.getTime() + ms);
      for (const [mid, role, ms] of [
        ['a', 'PATIENT', 5],
        ['b', 'THERAPIST', 5],
        ['c', 'PATIENT', 1],
      ] as const) {
        await messages.append({
          id: mid,
          sessionId: id,
          role,
          text: mid,
          createdAt: at(ms),
        });
      }

      expect((await messages.listBySession(id)).map((m) => m.id)).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect((await messages.findLast(id))?.id).toBe('c');
      await expect(messages.findLast('nope')).resolves.toBeNull();
    });

    it('stores the opening, the remote session and the in-sync flag atomically with the reply', async () => {
      const id = await start();
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-A' },
          { type: 'text', text: 'Hel' },
          { type: 'text', text: 'lo' },
        ],
      });

      const events = await run('u1', id);

      expect(events.map((e) => e.type)).toEqual([
        'started',
        'delta',
        'delta',
        'completed',
      ]);
      expect(await roles(id)).toEqual(['PATIENT']);
      expect(await remoteState(id)).toEqual({
        openai_session_id: 'remote-A',
        remote_in_sync: true,
      });
    });

    it('a failed reply stores nothing and leaves the remote out of sync; the retry stores exactly one', async () => {
      const id = await start();
      await run('u1', id); // opening
      await send.execute('u1', id, 'Question');
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(['part']),
        FakePatientReplyGenerator.success('Answer'),
      );

      const failed = await run('u1', id);

      expect(failed.at(-1)?.type).toBe('error');
      expect(await roles(id)).toEqual(['PATIENT', 'THERAPIST']);
      expect((await remoteState(id)).remote_in_sync).toBe(false);

      const retried = await run('u1', id);

      expect(retried.at(-1)?.type).toBe('completed');
      expect(await roles(id)).toEqual(['PATIENT', 'THERAPIST', 'PATIENT']);
      expect((await remoteState(id)).remote_in_sync).toBe(true);
    });

    it('concurrent therapist posts: exactly one is stored, the rest are reply-pending', async () => {
      const id = await start();
      await run('u1', id);

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => send.execute('u1', id, `m${i}`)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(ReplyPendingError);
        }
      }
      expect(await roles(id)).toEqual(['PATIENT', 'THERAPIST']);
    });

    it('ending the session mid-generation stores no reply and completes the case once', async () => {
      const id = await start();
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));
      const events: { type: string }[] = [];
      const consumed = (async () => {
        for await (const e of (await stream.execute('u1', id)).events) {
          events.push(e);
        }
      })();
      await new Promise((r) => setTimeout(r, 50));

      await end.execute('u1', id);
      await consumed;

      expect(events.map((e) => e.type)).toEqual(['started', 'delta']);
      expect(await roles(id)).toEqual([]);
      expect(registry.isActive(id)).toBe(false);
      expect(
        await count('SELECT count(*) FROM case_library.case_completions'),
      ).toBe(1);
    });

    it('discarding mid-generation cancels it and stores nothing', async () => {
      const id = await start();
      generator.enqueue({
        steps: [
          { type: 'wait', ms: 80 },
          { type: 'remote-session', openaiSessionId: 'remote-late' },
          { type: 'text', text: 'x' },
        ],
      });
      const abortedBefore = generator.aborted;
      const consumed = run('u1', id);
      await new Promise((r) => setTimeout(r, 20));

      await discard.execute('u1', id);
      await consumed;

      expect(await count('SELECT count(*) FROM chat_simulation.messages')).toBe(
        0,
      );
      expect(registry.isActive(id)).toBe(false);
      expect(generator.aborted).toBe(abortedBefore + 1);
    });

    it('a transaction context never outlives a failed unit of work', async () => {
      const fallback = dataSource.manager;
      const id = await start();

      await expect(
        uow.run(async () => {
          expect(activeManager(fallback)).not.toBe(fallback);
          await messages.append({
            id: 'rolled-back',
            sessionId: id,
            role: 'PATIENT',
            text: 'x',
            createdAt: t0,
          });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(activeManager(fallback)).toBe(fallback);
      expect(await messages.findLast(id)).toBeNull();
      // A write outside any unit of work goes straight to the pool and sticks.
      await messages.append({
        id: 'kept',
        sessionId: id,
        role: 'PATIENT',
        text: 'x',
        createdAt: t0,
      });
      expect((await messages.findLast(id))?.id).toBe('kept');
    });
  });

  describe('retention and erasure (05)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const runbook = (file: string) =>
      readFileSync(join(__dirname, '../../docs/runbooks', file), 'utf8');
    const queued = async () =>
      (
        await sql<{ openai_session_id: string }[]>(
          'SELECT openai_session_id FROM chat_simulation.agent_session_deletions ORDER BY 1',
        )
      ).map((r) => r.openai_session_id);
    const seed = async (
      id: string,
      ageDays: number,
      opts: {
        user?: string;
        caseId?: string;
        remote?: string | null;
        inSync?: boolean;
      } = {},
    ) => {
      await sql(
        `INSERT INTO chat_simulation.sessions
           (id, user_id, case_id, language, status, agent_id, openai_session_id, remote_in_sync, created_at)
         VALUES ($1, $2, $3, 'en', 'IN_PROGRESS', 'agent-1', $4, $5, $6)`,
        [
          id,
          opts.user ?? 'u1',
          opts.caseId ?? `case-${id}`,
          opts.remote ?? null,
          opts.inSync ?? true,
          new Date(t0.getTime() - ageDays * DAY),
        ],
      );
      await addMessage(id, 'THERAPIST');
      await addMessage(id, 'PATIENT');
    };

    it('deletes expired sessions and ALL their messages, queues remote ids in the same commit, keeps completion (AC-6, AC-13, AC-18)', async () => {
      await seed('old', 91, { remote: 'remote-old' });
      await seed('old-no-remote', 200);
      await seed('old-out-of-sync', 95, {
        remote: 'remote-oos',
        inSync: false,
      });
      await seed('young', 10, { remote: 'remote-young' });
      await sql(
        `INSERT INTO case_library.case_completions (user_id, case_id, completed_at)
         VALUES ('u1', 'case-old', now())`,
      );

      const result = await purge.execute();

      expect(result).toMatchObject({ sessions: 3, remoteSessionsQueued: 2 });
      expect(result.batches).toBe(2); // batch size 2
      expect(
        await sql('SELECT id FROM chat_simulation.sessions ORDER BY id'),
      ).toEqual([{ id: 'young' }]);
      expect(
        await count(
          `SELECT count(*) FROM chat_simulation.messages WHERE session_id <> 'young'`,
        ),
      ).toBe(0);
      expect(await queued()).toEqual(['remote-old', 'remote-oos']);
      expect(
        await count('SELECT count(*) FROM case_library.case_completions'),
      ).toBe(1);
    });

    it('is safe to run twice and never touches a session being written (SKIP LOCKED)', async () => {
      await seed('old', 91, { remote: 'remote-old' });
      await purge.execute();
      await expect(purge.execute()).resolves.toMatchObject({ sessions: 0 });
      expect(await queued()).toEqual(['remote-old']);

      await seed('locked', 91, { remote: 'remote-locked' });
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT 1 FROM chat_simulation.sessions WHERE id = 'locked' FOR UPDATE`,
      );
      try {
        await expect(purge.execute()).resolves.toMatchObject({ sessions: 0 });
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }
      await expect(purge.execute()).resolves.toMatchObject({ sessions: 1 });
      expect(await queued()).toEqual(['remote-locked', 'remote-old']);
    });

    it('rolls the deletion back when queueing fails (nothing deleted without its queue entry)', async () => {
      await seed('old', 91, { remote: 'remote-old' });
      const spy = jest
        .spyOn(queue, 'enqueue')
        .mockRejectedValueOnce(new Error('queue down'));

      await expect(purge.execute()).rejects.toThrow('queue down');
      spy.mockRestore();

      expect(await count('SELECT count(*) FROM chat_simulation.sessions')).toBe(
        1,
      );
      expect(await count('SELECT count(*) FROM chat_simulation.messages')).toBe(
        2,
      );
    });

    it('answers not found for an expired session before the job runs, then after (AC-6)', async () => {
      await seed('old', 91, { remote: 'remote-old' });
      await expect(get.execute('u1', 'old')).rejects.toThrow(
        'session not found',
      );
      await purge.execute();
      await expect(get.execute('u1', 'old')).rejects.toThrow(
        'session not found',
      );
    });

    it('manual erasure runbook deletes all sessions of the user and queues remote ids, including null-id sessions (AC-8, AC-19)', async () => {
      for (let i = 1; i <= 5; i++) {
        await seed(`a${i}`, i, {
          remote: i <= 3 ? `remote-a${i}` : null,
          inSync: i !== 2,
        });
      }
      await seed('other', 1, { user: 'u2', remote: 'remote-other' });
      await sql(
        `INSERT INTO chat_simulation.agent_session_deletions (openai_session_id, attempts, next_attempt_at, created_at)
         VALUES ('remote-a1', 0, now(), now())`,
      );

      const erasure = runbook('chat-simulation-user-erasure.sql');
      const [row] = await sql(erasure, ['u1']);

      expect(row).toEqual({
        sessions_deleted: '5',
        sessions_with_remote_id: '3',
        remote_sessions_queued: '2', // remote-a1 was already queued
      });
      expect(await queued()).toEqual(['remote-a1', 'remote-a2', 'remote-a3']);
      const [check] = await sql(
        runbook('chat-simulation-user-erasure-check.sql'),
        ['u1'],
      );
      expect(check).toEqual({ sessions_left: '0', orphan_messages: '0' });
      for (let i = 1; i <= 5; i++) {
        await expect(get.execute('u1', `a${i}`)).rejects.toThrow(
          'session not found',
        );
      }
      // The other user is untouched, and a re-run changes nothing.
      expect(
        await count(
          `SELECT count(*) FROM chat_simulation.sessions WHERE user_id = 'u2'`,
        ),
      ).toBe(1);
      const [again] = await sql(erasure, ['u1']);
      expect(again).toEqual({
        sessions_deleted: '0',
        sessions_with_remote_id: '0',
        remote_sessions_queued: '0',
      });
    });

    it('the audit query reports transcripts past 90 d + 24 h and overdue remote deletions (NFR-1, AC-7)', async () => {
      const audit = runbook('chat-simulation-retention-audit.sql');
      await sql(`DELETE FROM chat_simulation.sessions`);
      const real = Date.now();
      const ago = (days: number) => new Date(real - days * DAY);
      const insert = async (id: string, created: Date) => {
        await sql(
          `INSERT INTO chat_simulation.sessions (id, user_id, case_id, language, status, agent_id, created_at)
           VALUES ($1, 'u9', $2, 'en', 'IN_PROGRESS', 'a', $3)`,
          [id, `c-${id}`, created],
        );
        await addMessage(id, 'THERAPIST');
      };
      await insert('fresh', ago(1));
      await insert('in-grace', ago(90.5)); // past 90 d, inside the 24 h allowance
      expect((await sql(audit))[0]).toMatchObject({
        sessions_past_deadline: '0',
        messages_past_deadline: '0',
        orphan_messages: '0',
        remote_deletions_overdue: '0',
      });

      await insert('overdue', ago(92));
      await sql(
        `INSERT INTO chat_simulation.agent_session_deletions (openai_session_id, attempts, next_attempt_at, created_at)
         VALUES ('stuck', 3, now(), now() - interval '25 hours')`,
      );
      expect((await sql(audit))[0]).toMatchObject({
        sessions_past_deadline: '1',
        messages_past_deadline: '1',
        remote_deletions_overdue: '1',
        remote_deletions_pending: '1',
      });

      now = new Date(real);
      await purge.execute();
      expect((await sql(audit))[0]).toMatchObject({
        sessions_past_deadline: '0',
        messages_past_deadline: '0',
      });
    });
  });
});
