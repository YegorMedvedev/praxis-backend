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
import {
  FakePatientReplyGenerator,
  FakeRemoteSessionRemover,
} from '../../src/modules/chat-simulation/application/fakes';
import {
  PATIENT_REPLY_GENERATOR,
  REMOTE_SESSION_REMOVER,
} from '../../src/modules/chat-simulation/chat-simulation.tokens';
import { RetentionWorker } from '../../src/modules/chat-simulation/infrastructure/retention-worker';
import { SessionDeletionWorker } from '../../src/modules/chat-simulation/infrastructure/session-deletion-worker';
import { ReplyGenerationFailedError } from '../../src/shared/domain-error';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';
import { AddCaseTranslationAgentId1760000002000 } from '../../src/platform/database/migrations/1760000002000-AddCaseTranslationAgentId';
import { CreateChatSimulation1760000003000 } from '../../src/platform/database/migrations/1760000003000-CreateChatSimulation';
import { configureApp } from '../../src/platform/http/configure-app';
import {
  EMULATOR_PROJECT_ID,
  startFirebaseEmulator,
  type FirebaseEmulator,
} from './support/firebase-emulator';

const SESSIONS = '/api/v1/sessions';
const PROGRESS = '/api/v1/me/case-progress';

const seedCase = (id: string): SeedCase => ({
  id,
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 30,
  content: Object.fromEntries(
    (['en', 'ru'] as const).map((l) => [
      l,
      {
        title: `${id}-${l}`,
        teaser: 'teaser',
        scenario: 'scenario',
        patientName: 'Placeholder Patient',
        contentNote: null,
      },
    ]),
  ),
  agentIds: { en: 'agent-secret-en', ru: 'agent-secret-ru' },
});

/** A removal that fails once with an error whose message carries a marker. */
class FailOnceRemover extends FakeRemoteSessionRemover {
  armed = false;
  override remove(id: string): Promise<void> {
    if (this.armed) {
      this.armed = false;
      this.calls.push(id);
      return Promise.reject(new Error('MARKER-REMOVER-ERROR-55'));
    }
    return super.remove(id);
  }
}

describe('transcript privacy and retention (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let generator: FakePatientReplyGenerator;
  let remover: FailOnceRemover;
  let retention: RetentionWorker;
  let cleanup: SessionDeletionWorker;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const db = () => app.get(DataSource, { strict: false });
  const sql = <T = any>(query: string, params: unknown[] = []): Promise<T> =>
    db().query(query, params);
  const newUser = () => emulator.signUp(`privacy${++userCount}@example.test`);
  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const create = async (token: string, caseId: string, language = 'en') =>
    (
      await auth(request(server()).post(SESSIONS), token)
        .send({ case_id: caseId, language })
        .expect(201)
    ).body.id as string;
  const send = (token: string, id: string, text: string) =>
    auth(request(server()).post(`${SESSIONS}/${id}/messages`), token).send({
      text,
    });
  const messages = (token: string, id: string) =>
    auth(request(server()).get(`${SESSIONS}/${id}/messages`), token);
  const read = (token: string, id: string) =>
    auth(request(server()).get(`${SESSIONS}/${id}`), token);
  const reply = async (token: string, id: string): Promise<string> => {
    const response = await auth(
      request(server()).post(`${SESSIONS}/${id}/patient-replies`),
      token,
    )
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => callback(null, data));
      });
    return response.body as unknown as string;
  };
  /** A new session first needs the patient's opening before the learner can write. */
  const opening = async (token: string, id: string) => {
    generator.enqueue(FakePatientReplyGenerator.success('Opening.'));
    await reply(token, id);
  };
  const completedCount = async (token: string): Promise<number> =>
    (await auth(request(server()).get(PROGRESS), token).expect(200)).body
      .completed_count;
  const rows = async (query: string, params: unknown[] = []) =>
    Number((await sql(query, params))[0].count);
  const age = (id: string, days: number) =>
    sql(
      `UPDATE chat_simulation.sessions SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
      [id, days],
    );

  const captureLogs = () => {
    const lines: string[] = [];
    const capture = (chunk: unknown): boolean => {
      lines.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    };
    const spies = [
      jest.spyOn(process.stdout, 'write').mockImplementation(capture),
      jest.spyOn(process.stderr, 'write').mockImplementation(capture),
      ...(['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            lines.push(
              args
                .map((a) =>
                  typeof a === 'string'
                    ? a
                    : a instanceof Error
                      ? `${a.message}\n${a.stack ?? ''}`
                      : JSON.stringify(a),
                )
                .join(' '),
            );
          }),
      ),
    ];
    return {
      lines,
      restore: () => spies.forEach((s) => s.mockRestore()),
    };
  };

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

    generator = new FakePatientReplyGenerator();
    remover = new FailOnceRemover();
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PATIENT_REPLY_GENERATOR)
      .useValue(generator)
      .overrideProvider(REMOTE_SESSION_REMOVER)
      .useValue(remover)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    retention = app.get(RetentionWorker, { strict: false });
    cleanup = app.get(SessionDeletionWorker, { strict: false });

    await seedCases(db().manager, [
      seedCase('case-a'),
      seedCase('case-b'),
      seedCase('case-c'),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  describe('retention (AC-6, AC-13, AC-18)', () => {
    it('answers 404 for a 91-day-old session before and after the job, deletes the learner message too, keeps the completion, and the worker removes the remote session', async () => {
      const { idToken } = await newUser();
      const id = await create(idToken, 'case-a');
      generator.enqueue({
        steps: [
          { type: 'remote-session', openaiSessionId: 'remote-retention-1' },
          { type: 'text', text: 'Hello.' },
        ],
      });
      await reply(idToken, id);
      await send(idToken, id, 'learner words').expect(201);
      await opening(idToken, id);
      await auth(request(server()).patch(`${SESSIONS}/${id}`), idToken)
        .send({ status: 'ENDED_BY_THERAPIST' })
        .expect(200);
      expect(await completedCount(idToken)).toBe(1);
      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.messages WHERE session_id = $1`,
          [id],
        ),
      ).toBe(3);

      await age(id, 91);

      // Even before the job has run, the expired session is gone for clients.
      const before = await read(idToken, id).expect(404);
      expect(before.body.type).toBe('/problems/session-not-found');
      await messages(idToken, id).expect(404);
      await send(idToken, id, 'late').expect(404);
      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.sessions WHERE id = $1`,
          [id],
        ),
      ).toBe(1);

      await retention.tick();

      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.sessions WHERE id = $1`,
          [id],
        ),
      ).toBe(0);
      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.messages WHERE session_id = $1`,
          [id],
        ),
      ).toBe(0);
      await read(idToken, id).expect(404);
      expect(await completedCount(idToken)).toBe(1);
      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.agent_session_deletions WHERE openai_session_id = 'remote-retention-1'`,
        ),
      ).toBe(1);

      await cleanup.tick();
      expect(remover.removed).toContain('remote-retention-1');
      expect(
        await rows(
          `SELECT count(*) FROM chat_simulation.agent_session_deletions`,
        ),
      ).toBe(0);

      // A second run changes nothing.
      await retention.tick();
      expect(await completedCount(idToken)).toBe(1);
    });

    it('keeps a session that is 89 days old', async () => {
      const { idToken } = await newUser();
      const id = await create(idToken, 'case-b');
      await age(id, 89);
      await retention.tick();
      await read(idToken, id).expect(200);
    });
  });

  describe('learner distress is handled like any other message (AC-16)', () => {
    it('sends the text to the patient unchanged, with no flag, block or extra event', async () => {
      const { idToken } = await newUser();
      const id = await create(idToken, 'case-c');
      await opening(idToken, id);
      generator.enqueue(FakePatientReplyGenerator.success('I hear you.'));
      const distress = 'I feel hopeless myself';

      const sent = await send(idToken, id, distress).expect(201);
      const stream = await reply(idToken, id);

      expect(Object.keys(sent.body).sort()).toEqual(
        ['created_at', 'id', 'role', 'text'].sort(),
      );
      const events = [...stream.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
      expect(events).toEqual([
        'reply.started',
        'reply.delta',
        'reply.completed',
      ]);
      const request_ = generator.requests.at(-1)!;
      expect(request_.pending?.text).toBe(distress);
      const items = (await messages(idToken, id).expect(200)).body.items;
      expect(items.map((m: { role: string }) => m.role)).toEqual([
        'PATIENT',
        'THERAPIST',
        'PATIENT',
      ]);
      expect(items[2].text).toBe('I hear you.');
    });
  });

  describe('no transcript export (AC-17)', () => {
    it('exposes exactly the documented session routes and no export or download route', () => {
      const instance = app.getHttpAdapter().getInstance();
      const stack: any[] = (instance.router ?? instance._router).stack;
      const routes = stack
        .filter((layer) => layer.route)
        .flatMap((layer) =>
          Object.keys(layer.route.methods).map(
            (method) => `${method.toUpperCase()} ${layer.route.path}`,
          ),
        );
      const sessionRoutes = [
        ...new Set(
          routes
            .filter((r) => r.includes('/sessions'))
            .map((r) => r.replace(/\/$/, '')),
        ),
      ].sort();
      expect(sessionRoutes).toEqual(
        [
          'DELETE /api/v1/sessions/:session_id',
          'GET /api/v1/sessions/:session_id',
          'GET /api/v1/sessions/:session_id/messages',
          'PATCH /api/v1/sessions/:session_id',
          'POST /api/v1/sessions',
          'POST /api/v1/sessions/:session_id/messages',
          'POST /api/v1/sessions/:session_id/patient-replies',
        ].sort(),
      );
      expect(
        routes.filter((r) => /export|transcript|download|dump|backup/i.test(r)),
      ).toEqual([]);
    });

    it('returns message text only from the owner-only messages list', async () => {
      const { idToken } = await newUser();
      const other = await newUser();
      const id = await create(idToken, 'case-a');
      await opening(idToken, id);
      await send(idToken, id, 'MARKER-EXPORT-CHECK-31').expect(201);

      const session = await read(idToken, id).expect(200);
      expect(JSON.stringify(session.body)).not.toContain(
        'MARKER-EXPORT-CHECK-31',
      );
      await messages(other.idToken, id).expect(404);
      expect(
        JSON.stringify((await messages(idToken, id).expect(200)).body),
      ).toContain('MARKER-EXPORT-CHECK-31');
    });
  });

  describe('logs never carry transcript text (AC-9, NFR-3)', () => {
    it.each(['en', 'ru'] as const)(
      'finds no marker across create, message, stream, failure, end, discard, retention and cleanup (%s)',
      async (language) => {
        const word = language === 'ru' ? 'МАРКЕР' : 'MARKER';
        const m = (name: string) =>
          `${word}-${name}-${language}-${++userCount}`;
        const markers = {
          therapist: m('THERAPIST'),
          patient: m('PATIENT'),
          partial: m('PARTIAL'),
          provider: m('PROVIDER'),
          remote: m('REMOTE'),
          retentionRemote: m('RETREMOTE'),
          distress: m('DISTRESS'),
          tooLong: m('TOOLONG'),
          malformed: m('MALFORMED'),
        };
        const { idToken } = await newUser();
        const bodies: string[] = [];
        const logs = captureLogs();
        try {
          // create + message + stream + failure + end
          const a = await create(idToken, 'case-a', language);
          generator.enqueue({
            steps: [
              { type: 'remote-session', openaiSessionId: markers.remote },
              { type: 'text', text: markers.patient },
            ],
          });
          await reply(idToken, a);
          await send(idToken, a, markers.therapist).expect(201);
          await opening(idToken, a);
          await send(idToken, a, markers.distress).expect(201);
          generator.enqueue(
            FakePatientReplyGenerator.failAfter(
              [markers.partial],
              new ReplyGenerationFailedError(markers.provider),
            ),
          );
          await reply(idToken, a);
          await send(idToken, a, '   ').expect(400);
          const responses = [
            await send(
              idToken,
              a,
              `${markers.tooLong} ${'x'.repeat(2001)}`,
            ).expect(400),
            await auth(
              request(server()).post(`${SESSIONS}/${a}/messages`),
              idToken,
            )
              .set('Content-Type', 'application/json')
              .send(`{"text": "${markers.malformed}", `)
              .expect(400),
          ];
          bodies.push(...responses.map((r) => JSON.stringify(r.body)));
          await messages(idToken, a).expect(200);
          await auth(request(server()).patch(`${SESSIONS}/${a}`), idToken)
            .send({ status: 'ENDED_BY_THERAPIST' })
            .expect(200);

          // discard
          const b = await create(idToken, 'case-b', language);
          await opening(idToken, b);
          await send(idToken, b, markers.therapist).expect(201);
          await auth(
            request(server()).delete(`${SESSIONS}/${b}`),
            idToken,
          ).expect(204);

          // retention job on an expired session that has a remote id
          const c = await create(idToken, 'case-c', language);
          await opening(idToken, c);
          await send(idToken, c, markers.therapist).expect(201);
          await sql(
            `UPDATE chat_simulation.sessions SET openai_session_id = $2, created_at = now() - interval '100 days' WHERE id = $1`,
            [c, markers.retentionRemote],
          );
          await retention.tick();

          // cleanup worker: one failing pass whose error carries a marker, then success
          remover.armed = true;
          await sql(
            `UPDATE chat_simulation.agent_session_deletions SET next_attempt_at = now() - interval '1 hour'`,
          );
          await cleanup.tick();
          await sql(
            `UPDATE chat_simulation.agent_session_deletions SET next_attempt_at = now() - interval '1 hour'`,
          );
          await cleanup.tick();
        } finally {
          logs.restore();
        }

        const logged = logs.lines.join('\n');
        expect(logged).toContain('retention_purge');
        expect(logged).toContain('remote_session_deletions');
        for (const marker of [
          ...Object.values(markers),
          'MARKER-REMOVER-ERROR-55',
          'agent-secret',
          idToken,
        ]) {
          expect(logged).not.toContain(marker);
        }
        for (const marker of [markers.tooLong, markers.malformed]) {
          expect(bodies.join('\n')).not.toContain(marker);
        }
        expect(remover.removed).toContain(markers.retentionRemote);
      },
    );
  });
});
