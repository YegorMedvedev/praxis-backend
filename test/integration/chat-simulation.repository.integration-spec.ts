import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { RecordCaseCompletion } from '../../src/modules/case-library/application/record-case-completion';
import { CaseCompletionOrmEntity } from '../../src/modules/case-library/infrastructure/persistence/case-completion.orm-entity';
import { TypeOrmCaseCompletionRepository } from '../../src/modules/case-library/infrastructure/persistence/typeorm-case-completion.repository';
import { CreateSession } from '../../src/modules/chat-simulation/application/create-session';
import { DiscardSession } from '../../src/modules/chat-simulation/application/discard-session';
import { EndSession } from '../../src/modules/chat-simulation/application/end-session';
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
  let now: Date;
  let nextId: number;
  let failRecording: boolean;

  let create: CreateSession;
  let get: GetSession;
  let end: EndSession;
  let discard: DiscardSession;

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
    const canceller = { cancel: () => undefined };
    create = new CreateSession(
      sessions,
      agents,
      queue,
      uow,
      canceller,
      { next: () => `s${++nextId}` },
      clock,
    );
    get = new GetSession(sessions);
    end = new EndSession(sessions, completions, uow, canceller, clock);
    discard = new DiscardSession(sessions, queue, uow, canceller, clock);
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
});
