import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { SeedCase } from '../../src/modules/case-library/infrastructure/seed/case-seed.data';
import { seedCases } from '../../src/modules/case-library/infrastructure/seed/case-seeder';
import { FakeRemoteSessionRemover } from '../../src/modules/chat-simulation/application/fakes';
import { ProcessSessionDeletions } from '../../src/modules/chat-simulation/application/process-session-deletions';
import { REMOTE_SESSION_REMOVER } from '../../src/modules/chat-simulation/chat-simulation.tokens';
import { AddCaseTranslationAgentId1760000002000 } from '../../src/platform/database/migrations/1760000002000-AddCaseTranslationAgentId';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';
import { CreateChatSimulation1760000003000 } from '../../src/platform/database/migrations/1760000003000-CreateChatSimulation';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';
import { configureApp } from '../../src/platform/http/configure-app';
import {
  EMULATOR_PROJECT_ID,
  startFirebaseEmulator,
  type FirebaseEmulator,
} from './support/firebase-emulator';

const SESSIONS = '/api/v1/sessions';
const PROGRESS = '/api/v1/me/case-progress';

const text = (title: string) => ({
  title,
  teaser: `${title} teaser`,
  scenario: `${title} scenario`,
  patientName: 'Placeholder Patient',
  contentNote: null,
});
const seedCase = (
  id: string,
  languages: ('en' | 'ru')[],
  agentIds: Partial<Record<'en' | 'ru', string>>,
): SeedCase => ({
  id,
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 30,
  content: Object.fromEntries(languages.map((l) => [l, text(`${id}-${l}`)])),
  agentIds,
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('sessions (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let remover: FakeRemoteSessionRemover;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const db = () => app.get(DataSource, { strict: false });
  const sql = <T = any>(query: string, params: unknown[] = []): Promise<T> =>
    db().query(query, params);
  const newUser = () => emulator.signUp(`sessions${++userCount}@example.test`);

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const create = (token: string, body: object) =>
    auth(request(server()).post(SESSIONS), token).send(body);
  const read = (token: string, id: string) =>
    auth(request(server()).get(`${SESSIONS}/${id}`), token);
  const end = (
    token: string,
    id: string,
    body: object = { status: 'ENDED_BY_THERAPIST' },
  ) => auth(request(server()).patch(`${SESSIONS}/${id}`), token).send(body);
  const discard = (token: string, id: string) =>
    auth(request(server()).delete(`${SESSIONS}/${id}`), token);
  const completedCount = async (token: string): Promise<number> =>
    (await auth(request(server()).get(PROGRESS), token).expect(200)).body
      .completed_count;
  const start = async (token: string, caseId = 'case-a', language = 'en') =>
    (await create(token, { case_id: caseId, language }).expect(201)).body;

  beforeAll(async () => {
    [postgres, emulator] = await Promise.all([
      new PostgreSqlContainer('postgres:17-alpine').start(),
      startFirebaseEmulator(),
    ]);
    process.env.DB_HOST = postgres.getHost();
    process.env.DB_PORT = String(postgres.getPort());
    process.env.DB_USER = postgres.getUsername();
    process.env.DB_PASSWORD = postgres.getPassword();
    process.env.DB_NAME = postgres.getDatabase();
    process.env.FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = emulator.host;
    process.env.CONSENT_TERMS_VERSIONS = 'T1';
    process.env.CONSENT_PRIVACY_VERSIONS = 'P1';
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.test';
    process.env.APP_BASE_URL = 'http://app.example.test';
    process.env.RESEND_API_KEY = 're_e2e_fake_key_do_not_leak';
    process.env.OPENAI_API_KEY = 'sk-e2e-fake-key-do-not-leak';
    process.env.PASSWORD_RESET_EMAIL_FROM = 'no-reply@mail.example.test';

    const migrator = await new DataSource({
      type: 'postgres',
      url: postgres.getConnectionUri(),
      migrations: [
        CreateUsersProfiles1760000000000,
        CreateCaseLibrary1760000001000,
        AddCaseTranslationAgentId1760000002000,
        CreateChatSimulation1760000003000,
      ],
    }).initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    remover = new FakeRemoteSessionRemover();
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REMOTE_SESSION_REMOVER)
      .useValue(remover)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    await seedCases(db().manager, [
      seedCase('case-a', ['en', 'ru'], {
        en: 'agent-secret-en-a',
        ru: 'agent-secret-ru-a',
      }),
      seedCase('case-b', ['en', 'ru'], {
        en: 'agent-secret-en-b',
        ru: 'agent-secret-ru-b',
      }),
      // Visible, but no agent for Russian.
      seedCase('case-no-ru-agent', ['en', 'ru'], { en: 'agent-secret-en-c' }),
      // Hidden: no Russian text.
      seedCase('case-hidden', ['en'], { en: 'agent-secret-en-h' }),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  describe('authentication', () => {
    it.each([
      ['post', SESSIONS],
      ['get', `${SESSIONS}/x`],
      ['patch', `${SESSIONS}/x`],
      ['delete', `${SESSIONS}/x`],
    ] as const)('%s requires a bearer token', async (method, path) => {
      const response = await request(server())
        [method](path)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer')
        .expect('Cache-Control', 'no-store')
        .expect('Content-Type', /application\/problem\+json/);
      expect(response.body.type).toBe('/problems/unauthenticated');
    });
  });

  describe('POST /sessions', () => {
    it('creates an in-progress session (AC-1, AC-17)', async () => {
      const { idToken } = await newUser();

      const response = await create(idToken, {
        case_id: 'case-a',
        language: 'ru',
        ignored: true,
      })
        .expect(201)
        .expect('Cache-Control', 'no-store')
        .expect('Content-Type', /application\/json/);

      const { body } = response;
      expect(response.headers.location).toBe(`${SESSIONS}/${body.id}`);
      expect(response.headers['x-flow-id']).toBeTruthy();
      expect(body).toEqual({
        id: expect.any(String),
        case_id: 'case-a',
        language: 'ru',
        status: 'IN_PROGRESS',
        created_at: expect.stringMatching(ISO),
        ended_at: null,
        stats: {
          therapist_message_count: 0,
          patient_message_count: 0,
          duration_seconds: null,
          ended_by: null,
        },
      });
      const stored = await sql(
        'SELECT agent_id FROM chat_simulation.sessions WHERE id = $1',
        [body.id],
      );
      expect(stored[0].agent_id).toBe('agent-secret-ru-a');
      expect(JSON.stringify(body)).not.toMatch(/agent|openai/i);
    });

    it('answers 404 case-not-found for unknown, hidden and agentless cases and stores nothing (AC-2, AC-15)', async () => {
      const { idToken, uid } = await newUser();

      for (const body of [
        { case_id: 'nope', language: 'en' },
        { case_id: 'case-hidden', language: 'en' },
        { case_id: 'case-no-ru-agent', language: 'ru' },
      ]) {
        const response = await create(idToken, body)
          .expect(404)
          .expect('Content-Type', /application\/problem\+json/);
        expect(response.body.type).toBe('/problems/case-not-found');
      }
      const rows = await sql(
        'SELECT count(*)::int AS n FROM chat_simulation.sessions WHERE user_id = $1',
        [uid],
      );
      expect(rows[0].n).toBe(0);
      await create(idToken, {
        case_id: 'case-no-ru-agent',
        language: 'en',
      }).expect(201);
    });

    it.each([
      [{ language: 'en' }, 'case_id', 'REQUIRED'],
      [{ case_id: 'case-a' }, 'language', 'REQUIRED'],
      [{ case_id: 'case-a', language: 'de' }, 'language', 'INVALID_VALUE'],
      [{ case_id: 'case-a', language: 'EN' }, 'language', 'INVALID_VALUE'],
      [{ case_id: 5, language: 'en' }, 'case_id', 'INVALID_TYPE'],
    ])(
      'rejects %j with invalid-request (%s %s)',
      async (body, name, reason) => {
        const { idToken } = await newUser();
        const response = await create(idToken, body).expect(400);
        expect(response.body.type).toBe('/problems/invalid-request');
        expect(response.body.invalid_params).toEqual([{ name, reason }]);
      },
    );

    it('replaces every other session of the user for the case, keeps completion (AC-3)', async () => {
      const { idToken } = await newUser();
      const a = await start(idToken);
      await end(idToken, a.id).expect(200);
      expect(await completedCount(idToken)).toBe(1);

      const b = await start(idToken);

      expect(b.status).toBe('IN_PROGRESS');
      expect(b.id).not.toBe(a.id);
      const gone = await read(idToken, a.id).expect(404);
      expect(gone.body.type).toBe('/problems/session-not-found');
      await read(idToken, b.id).expect(200);
      expect(await completedCount(idToken)).toBe(1);
    });

    it('leaves sessions of other cases and other users alone', async () => {
      const one = await newUser();
      const two = await newUser();
      const mine = await start(one.idToken, 'case-a');
      const otherCase = await start(one.idToken, 'case-b');
      const theirs = await start(two.idToken, 'case-a');

      await start(one.idToken, 'case-a');

      await read(one.idToken, otherCase.id).expect(200);
      await read(two.idToken, theirs.id).expect(200);
      await read(one.idToken, mine.id).expect(404);
    });
  });

  describe('GET /sessions/:id', () => {
    it('reports foreign, unknown and undecodable ids as session-not-found, never 403 (AC-10)', async () => {
      const owner = await newUser();
      const other = await newUser();
      const { id } = await start(owner.idToken);

      for (const path of [id, 'unknown', '%E0%A4%A']) {
        const response = await read(other.idToken, path)
          .expect(404)
          .expect('Content-Type', /application\/problem\+json/);
        expect(response.body.type).toBe('/problems/session-not-found');
      }
      await read(owner.idToken, id).expect(200);
    });

    it('returns counts of stored messages and a rounded-down duration, identically on repeats (AC-11)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      for (const role of [
        'THERAPIST',
        'PATIENT',
        'THERAPIST',
        'PATIENT',
        'THERAPIST',
        'PATIENT',
      ]) {
        await sql(
          `INSERT INTO chat_simulation.messages (id, session_id, role, text, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'x', now())`,
          [id, role],
        );
      }
      await end(idToken, id).expect(200);
      await sql(
        `UPDATE chat_simulation.sessions SET created_at = ended_at - interval '125.7 seconds' WHERE id = $1`,
        [id],
      );

      const first = (await read(idToken, id).expect(200)).body;
      const second = (await read(idToken, id).expect(200)).body;

      expect(first.stats).toEqual({
        therapist_message_count: 3,
        patient_message_count: 3,
        duration_seconds: 125,
        ended_by: 'THERAPIST',
      });
      expect(second).toEqual(first);
    });
  });

  describe('PATCH /sessions/:id', () => {
    it('ends the session, sets ended_at and completes the case (AC-4)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      expect(await completedCount(idToken)).toBe(0);

      const response = await end(idToken, id)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(response.body).toMatchObject({
        id,
        status: 'ENDED_BY_THERAPIST',
        ended_at: expect.stringMatching(ISO),
        stats: { ended_by: 'THERAPIST', duration_seconds: expect.any(Number) },
      });
      expect(Number.isInteger(response.body.stats.duration_seconds)).toBe(true);
      expect(await completedCount(idToken)).toBe(1);
    });

    it('is idempotent with an identical body (AC-5)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      const first = (await end(idToken, id).expect(200)).body;

      const second = (await end(idToken, id).expect(200)).body;

      expect(second).toEqual(first);
    });

    it.each([
      { status: 'IN_PROGRESS' },
      { status: 'ENDED_BY_PATIENT' },
      {},
      { status: 5 },
    ])(
      'rejects %j with invalid-request and changes nothing (AC-6)',
      async (body) => {
        const { idToken } = await newUser();
        const { id } = await start(idToken);

        const response = await end(idToken, id, body).expect(400);

        expect(response.body.type).toBe('/problems/invalid-request');
        expect((await read(idToken, id).expect(200)).body.status).toBe(
          'IN_PROGRESS',
        );
        expect(await completedCount(idToken)).toBe(0);
      },
    );

    it('answers 404 for a foreign id and does not complete anything', async () => {
      const owner = await newUser();
      const other = await newUser();
      const { id } = await start(owner.idToken);

      const response = await end(other.idToken, id).expect(404);

      expect(response.body.type).toBe('/problems/session-not-found');
      expect(await completedCount(owner.idToken)).toBe(0);
    });

    it('answers 409 session-ended for a session ended by the patient', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      await sql(
        `UPDATE chat_simulation.sessions SET status = 'ENDED_BY_PATIENT', ended_at = now() WHERE id = $1`,
        [id],
      );

      const response = await end(idToken, id).expect(409);

      expect(response.body.type).toBe('/problems/session-ended');
      expect(response.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
    });

    it('under concurrent ends returns one identical body and one completion (AC-13)', async () => {
      const { idToken, uid } = await newUser();
      const { id } = await start(idToken);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => end(idToken, id)),
      );

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(
        1,
      );
      const rows = await sql(
        'SELECT count(*)::int AS n FROM case_library.case_completions WHERE user_id = $1',
        [uid],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('discards an in-progress session without completing the case (AC-9)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);

      await discard(idToken, id)
        .expect(204)
        .expect('Cache-Control', 'no-store');

      await read(idToken, id).expect(404);
      expect(await completedCount(idToken)).toBe(0);
    });

    it('keeps the completion of an ended session (AC-9)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      await end(idToken, id).expect(200);

      await discard(idToken, id).expect(204);

      await read(idToken, id).expect(404);
      expect(await completedCount(idToken)).toBe(1);
    });

    it('is a silent 204 for repeats, foreign ids, unknown ids and undecodable ids (AC-10)', async () => {
      const owner = await newUser();
      const other = await newUser();
      const { id } = await start(owner.idToken);

      await discard(other.idToken, id).expect(204);
      await read(owner.idToken, id).expect(200);
      await discard(owner.idToken, id).expect(204);
      await discard(owner.idToken, id).expect(204);
      await discard(owner.idToken, 'unknown').expect(204);
      await discard(owner.idToken, '%E0%A4%A').expect(204);
    });

    it('queues the remote session and a worker pass deletes it, retrying failures (AC-16)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-e2e-1' WHERE id = $1`,
        [id],
      );

      await discard(idToken, id).expect(204);

      const queued = () =>
        sql(
          `SELECT attempts FROM chat_simulation.agent_session_deletions WHERE openai_session_id = 'remote-e2e-1'`,
        );
      expect(await queued()).toEqual([{ attempts: 0 }]);

      const worker = app.get(ProcessSessionDeletions, { strict: false });
      remover.failures = 2;
      await worker.execute();
      expect(await queued()).toEqual([{ attempts: 1 }]);
      const due = () =>
        sql(
          `UPDATE chat_simulation.agent_session_deletions SET next_attempt_at = now() - interval '1 second'`,
        );
      await due();
      await worker.execute();
      expect(await queued()).toEqual([{ attempts: 2 }]);
      expect(remover.removed).not.toContain('remote-e2e-1');
      await due();
      await worker.execute();
      expect(await queued()).toEqual([]);
      expect(remover.removed).toContain('remote-e2e-1');
    });

    it('replacing a session queues its remote session in the same commit (AC-16)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-e2e-2' WHERE id = $1`,
        [id],
      );

      await start(idToken);

      const rows = await sql(
        `SELECT 1 FROM chat_simulation.agent_session_deletions WHERE openai_session_id = 'remote-e2e-2'`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('privacy', () => {
    it('logs flow ids but never message text, agent ids, remote ids or the token (AC-14)', async () => {
      const { idToken } = await newUser();
      const { id } = await start(idToken);
      await sql(
        `UPDATE chat_simulation.sessions SET openai_session_id = 'remote-secret-marker' WHERE id = $1`,
        [id],
      );
      await sql(
        `INSERT INTO chat_simulation.messages (id, session_id, role, text, created_at)
         VALUES ('m-marker', $1, 'THERAPIST', 'MARKER-TRANSCRIPT-TEXT-91', now())`,
        [id],
      );
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) =>
          jest
            .spyOn(Logger.prototype, level)
            .mockImplementation((...args: unknown[]) => {
              const m = args[0];
              lines.push(typeof m === 'string' ? m : JSON.stringify(m));
            }),
      );
      const bodies: string[] = [];
      try {
        bodies.push(JSON.stringify((await read(idToken, id).expect(200)).body));
        bodies.push(JSON.stringify((await end(idToken, id).expect(200)).body));
        await create(idToken, {
          case_id: 'MARKER-CASE-ID',
          language: 'en',
        }).expect(404);
        await discard(idToken, id).expect(204);
        const worker = app.get(ProcessSessionDeletions, { strict: false });
        remover.failures = 1;
        await worker.execute();
      } finally {
        spies.forEach((s) => s.mockRestore());
      }

      const logged = lines.join('\n');
      expect(logged).toContain('flow_id');
      expect(logged).not.toContain(idToken);
      expect(logged).not.toContain('MARKER-TRANSCRIPT-TEXT-91');
      expect(logged).not.toContain('MARKER-CASE-ID');
      expect(logged).not.toContain('remote-secret-marker');
      expect(logged).not.toContain('agent-secret');
      for (const body of bodies) {
        expect(body).not.toContain('MARKER-TRANSCRIPT-TEXT-91');
        expect(body).not.toMatch(/agent|openai|remote-secret/i);
      }
    });
  });
});
