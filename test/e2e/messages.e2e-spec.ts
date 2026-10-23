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
  REPLY_TIMINGS,
} from '../../src/modules/chat-simulation/chat-simulation.tokens';
import { ReplyGenerationFailedError } from '../../src/shared/domain-error';
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
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const caseA: SeedCase = {
  id: 'case-a',
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 30,
  content: Object.fromEntries(
    (['en', 'ru'] as const).map((l) => [
      l,
      {
        title: `a-${l}`,
        teaser: 'teaser',
        scenario: 'scenario',
        patientName: 'Placeholder Patient',
        contentNote: null,
      },
    ]),
  ),
  agentIds: { en: 'agent-secret-en', ru: 'agent-secret-ru' },
};

interface Frame {
  event?: string;
  data?: string;
  comment?: string;
  raw: string;
}

/** A minimal SSE client over fetch, so frames can be read as they arrive. */
class SseClient {
  readonly frames: Frame[] = [];
  private buffer = '';
  private ended = false;
  private waiters: (() => void)[] = [];

  private constructor(
    readonly response: Response,
    private readonly abort: AbortController,
  ) {}

  static async open(url: string, token: string): Promise<SseClient> {
    const abort = new AbortController();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: abort.signal,
    });
    const client = new SseClient(response, abort);
    if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
      void client.pump();
    } else {
      client.ended = true;
    }
    return client;
  }

  private async pump(): Promise<void> {
    const reader = this.response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let at: number;
        while ((at = this.buffer.indexOf('\n\n')) >= 0) {
          const raw = this.buffer.slice(0, at);
          this.buffer = this.buffer.slice(at + 2);
          this.frames.push(parseFrame(raw));
          this.wake();
        }
      }
    } catch {
      // Aborted by the test.
    }
    this.ended = true;
    this.wake();
  }

  private wake(): void {
    this.waiters.splice(0).forEach((w) => w());
  }

  /** Resolves once `predicate` holds for the frames so far, or the stream ended. */
  async until(
    predicate: (frames: Frame[]) => boolean,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.frames) && !this.ended) {
      if (Date.now() > deadline) throw new Error('timed out waiting for SSE');
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  async finished(timeoutMs = 10_000): Promise<Frame[]> {
    await this.until(() => false, timeoutMs).catch(() => undefined);
    return this.frames;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  close(): void {
    this.abort.abort();
  }

  events(): { event: string; data: any }[] {
    return this.frames
      .filter((f) => f.event)
      .map((f) => ({ event: f.event!, data: JSON.parse(f.data!) }));
  }

  names(): string[] {
    return this.events().map((e) => e.event);
  }
}

function parseFrame(raw: string): Frame {
  const frame: Frame = { raw };
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = line.slice(6);
  }
  return frame;
}

describe('messages and patient replies (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let generator: FakePatientReplyGenerator;
  let baseUrl: string;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const db = () => app.get(DataSource, { strict: false });
  const sql = <T = any>(query: string, params: unknown[] = []): Promise<T> =>
    db().query(query, params);
  const newUser = () => emulator.signUp(`messages${++userCount}@example.test`);

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);
  const startSession = async (token: string, language = 'en') =>
    (
      await auth(request(server()).post(SESSIONS), token)
        .send({ case_id: 'case-a', language })
        .expect(201)
    ).body.id as string;
  const post = (token: string, id: string, body: object) =>
    auth(request(server()).post(`${SESSIONS}/${id}/messages`), token).send(
      body,
    );
  const list = (token: string, id: string) =>
    auth(request(server()).get(`${SESSIONS}/${id}/messages`), token);
  const openReply = (token: string, id: string) =>
    SseClient.open(`${baseUrl}${SESSIONS}/${id}/patient-replies`, token);
  const replyOnce = async (token: string, id: string) => {
    const client = await openReply(token, id);
    await client.finished();
    return client;
  };
  const patientRows = async (id: string) =>
    Number(
      (
        await sql(
          `SELECT count(*) FROM chat_simulation.messages WHERE session_id = $1 AND role = 'PATIENT'`,
          [id],
        )
      )[0].count,
    );
  const waitFor = async (check: () => boolean, ms = 5000) => {
    const deadline = Date.now() + ms;
    while (!check()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
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
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PATIENT_REPLY_GENERATOR)
      .useValue(generator)
      .overrideProvider(REMOTE_SESSION_REMOVER)
      .useValue(new FakeRemoteSessionRemover())
      // Short waits so the 15 s rules can be exercised quickly.
      .overrideProvider(REPLY_TIMINGS)
      .useValue({ idleTimeoutMs: 700, keepAliveMs: 200 })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    await seedCases(db().manager, [caseA]);
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  describe('authentication and ownership', () => {
    it.each([
      ['post', `${SESSIONS}/x/messages`],
      ['get', `${SESSIONS}/x/messages`],
      ['post', `${SESSIONS}/x/patient-replies`],
    ] as const)('%s %s requires a bearer token', async (method, path) => {
      const response = await request(server())
        [method](path)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer')
        .expect('Content-Type', /application\/problem\+json/);
      expect(response.body.type).toBe('/problems/unauthenticated');
    });

    it('reports foreign, unknown and undecodable sessions as session-not-found', async () => {
      const owner = await newUser();
      const other = await newUser();
      const id = await startSession(owner.idToken);

      for (const sid of [id, 'unknown']) {
        for (const response of [
          await post(other.idToken, sid, { text: 'hi' }).expect(404),
          await list(other.idToken, sid).expect(404),
          await auth(
            request(server()).post(`${SESSIONS}/${sid}/patient-replies`),
            other.idToken,
          ).expect(404),
        ]) {
          expect(response.body.type).toBe('/problems/session-not-found');
          expect(response.headers['content-type']).toMatch(
            /application\/problem\+json/,
          );
        }
      }
    });
  });

  describe('the opening and the stream (AC-1, AC-3, AC-16)', () => {
    it('streams started, deltas, completed with SSE headers and single-line JSON frames', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue(
        FakePatientReplyGenerator.success('Hel', 'lo ', 'there'),
      );

      const client = await openReply(idToken, id);
      const { headers, status } = client.response;
      await client.finished();

      expect(status).toBe(200);
      expect(headers.get('content-type')).toMatch(/^text\/event-stream/);
      expect(headers.get('cache-control')).toBe('no-store');
      expect(headers.get('x-accel-buffering')).toBe('no');
      expect(headers.get('x-flow-id')).toBeTruthy();
      expect(client.names()).toEqual([
        'reply.started',
        'reply.delta',
        'reply.delta',
        'reply.delta',
        'reply.completed',
      ]);
      for (const frame of client.frames) {
        expect(frame.raw.split('\n')).toHaveLength(2);
        expect(frame.raw).toMatch(/^event: [a-z.]+\ndata: \{.*\}$/);
      }
      const events = client.events();
      const started = events[0].data;
      const deltas = events.filter((e) => e.event === 'reply.delta');
      expect(deltas.map((d) => d.data.index)).toEqual([0, 1, 2]);
      expect(
        deltas.every((d) => d.data.message_id === started.message_id),
      ).toBe(true);
      const message = events.at(-1)!.data.message;
      expect(message).toEqual({
        id: started.message_id,
        role: 'PATIENT',
        text: 'Hello there',
        created_at: expect.stringMatching(ISO),
      });
      expect(deltas.map((d) => d.data.text).join('')).toBe(message.text);
      expect(client.isEnded).toBe(true);

      const stored = (await list(idToken, id).expect(200)).body;
      expect(stored).toEqual({ items: [message] });
    });

    it('flushes the first delta before generation ends and sends keep-alive comments (AC-10, AC-16)', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue({
        steps: [
          { type: 'text', text: 'first' },
          { type: 'wait', ms: 500 },
          { type: 'text', text: 'second' },
        ],
      });

      const client = await openReply(idToken, id);
      const startedAt = Date.now();
      await client.until((f) => f.some((x) => x.event === 'reply.delta'));
      const firstDeltaAfter = Date.now() - startedAt;

      expect(client.names()).not.toContain('reply.completed');
      expect(firstDeltaAfter).toBeLessThan(400);
      await client.finished();
      const comments = client.frames.filter((f) => f.comment === 'keep-alive');
      expect(comments.length).toBeGreaterThanOrEqual(2);
      expect(comments.every((f) => f.raw === ': keep-alive')).toBe(true);
      expect(client.names().at(-1)).toBe('reply.completed');
    });

    it('does not store anything until the reply completes (state after a crash mid-reply)', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue(FakePatientReplyGenerator.stallAfter('partial'));

      const client = await openReply(idToken, id);
      await client.until((f) => f.some((x) => x.event === 'reply.delta'));

      expect((await list(idToken, id).expect(200)).body.items).toEqual([]);
      const abortedBefore = generator.aborted;
      client.close();
      await waitFor(() => generator.aborted > abortedBefore);
    });
  });

  describe('POST /sessions/:id/messages (AC-2, AC-4, AC-5)', () => {
    it('stores the trimmed text and ignores unknown properties', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);

      const response = await post(idToken, id, {
        text: '  Hello  ',
        role: 'PATIENT',
        id: 'forced',
      })
        .expect(201)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toEqual({
        id: expect.any(String),
        role: 'THERAPIST',
        text: 'Hello',
        created_at: expect.stringMatching(ISO),
      });
      expect(response.body.id).not.toBe('forced');
      const items = (await list(idToken, id).expect(200)).body.items;
      expect(items.map((m: any) => m.role)).toEqual(['PATIENT', 'THERAPIST']);
    });

    it.each([
      [{}, 'REQUIRED'],
      [{ text: null }, 'REQUIRED'],
      [{ text: 5 }, 'INVALID_TYPE'],
      [{ text: '   ' }, 'TOO_SHORT'],
      [{ text: '' }, 'TOO_SHORT'],
      [{ text: 'x'.repeat(2001) }, 'TOO_LONG'],
    ])('rejects %j with invalid-request (%s)', async (body, reason) => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);

      const response = await post(idToken, id, body).expect(400);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.invalid_params).toEqual([{ name: 'text', reason }]);
    });

    it('accepts exactly 2000 characters', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);

      await post(idToken, id, { text: ' ' + 'x'.repeat(2000) + ' ' }).expect(
        201,
      );
    });

    it('answers reply-pending when no opening was delivered and while a message is unanswered', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);

      const empty = await post(idToken, id, { text: 'hi' }).expect(409);
      expect(empty.body.type).toBe('/problems/reply-pending');

      await replyOnce(idToken, id);
      await post(idToken, id, { text: 'one' }).expect(201);
      const second = await post(idToken, id, { text: 'two' }).expect(409);
      expect(second.body.type).toBe('/problems/reply-pending');
      expect((await list(idToken, id)).body.items).toHaveLength(2);
    });

    it('answers session-ended for an ended session on every endpoint that needs it', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);
      await auth(request(server()).patch(`${SESSIONS}/${id}`), idToken)
        .send({ status: 'ENDED_BY_THERAPIST' })
        .expect(200);

      const posted = await post(idToken, id, { text: 'hi' }).expect(409);
      const streamed = await auth(
        request(server()).post(`${SESSIONS}/${id}/patient-replies`),
        idToken,
      ).expect(409);

      expect(posted.body.type).toBe('/problems/session-ended');
      expect(streamed.body.type).toBe('/problems/session-ended');
      expect(streamed.headers['content-type']).toMatch(
        /application\/problem\+json/,
      );
      await list(idToken, id).expect(200);
    });
  });

  describe('reply conditions (AC-3, AC-6, AC-17)', () => {
    it('streams the reply to a posted message, handing the generator the transcript', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken, 'ru');
      await replyOnce(idToken, id);
      await post(idToken, id, { text: 'Question' }).expect(201);
      generator.enqueue(FakePatientReplyGenerator.success('An', 'swer'));

      const client = await replyOnce(idToken, id);

      const message = client.events().at(-1)!.data.message;
      expect(message.text).toBe('Answer');
      const call = generator.requests.at(-1)!;
      expect(call.session.language).toBe('ru');
      expect(call.session.agentId).toBe('agent-secret-ru');
      expect(call.pending?.text).toBe('Question');
      expect(call.history).toHaveLength(1);
    });

    it('answers no-reply-pending when the last message is the patient', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);

      const response = await auth(
        request(server()).post(`${SESSIONS}/${id}/patient-replies`),
        idToken,
      ).expect(409);

      expect(response.body.type).toBe('/problems/no-reply-pending');
    });

    it('lets one of two concurrent streams run, the other gets reply-pending, then a new request is accepted', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue({
        steps: [
          { type: 'text', text: 'a' },
          { type: 'wait', ms: 300 },
          { type: 'text', text: 'b' },
        ],
      });

      const first = await openReply(idToken, id);
      await first.until((f) => f.length > 0);
      const second = await auth(
        request(server()).post(`${SESSIONS}/${id}/patient-replies`),
        idToken,
      ).expect(409);

      expect(second.body.type).toBe('/problems/reply-pending');
      await first.finished();
      expect(first.names().at(-1)).toBe('reply.completed');
      expect(await patientRows(id)).toBe(1);
      // After it ended the slot is free: the opening is answered, so the
      // answer is "nothing pending", not "busy".
      const third = await auth(
        request(server()).post(`${SESSIONS}/${id}/patient-replies`),
        idToken,
      ).expect(409);
      expect(third.body.type).toBe('/problems/no-reply-pending');
    });
  });

  describe('failures (AC-9, AC-11, AC-15, AC-18)', () => {
    it('sends an error event with the problem object and stores no partial message', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);
      await post(idToken, id, { text: 'Question' }).expect(201);
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(
          ['Par', 'tial'],
          new ReplyGenerationFailedError('PROVIDER-SECRET-MESSAGE'),
        ),
      );

      const client = await openReply(idToken, id);
      const flowId = client.response.headers.get('x-flow-id');
      await client.finished();

      expect(client.names()).toEqual([
        'reply.started',
        'reply.delta',
        'reply.delta',
        'error',
      ]);
      const problem = client.events().at(-1)!.data;
      expect(problem).toEqual({
        type: '/problems/reply-generation-failed',
        title: 'Reply Generation Failed',
        status: 502,
        detail: 'The patient reply could not be produced.',
        instance: `${SESSIONS}/${id}/patient-replies`,
        flow_id: flowId,
      });
      expect(client.isEnded).toBe(true);
      expect(JSON.stringify(client.frames)).not.toContain(
        'PROVIDER-SECRET-MESSAGE',
      );
      const items = (await list(idToken, id).expect(200)).body.items;
      expect(items.map((m: any) => m.role)).toEqual(['PATIENT', 'THERAPIST']);
    });

    it('retrying after a failure stores exactly one patient message and no duplicate therapist message (AC-18)', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      await replyOnce(idToken, id);
      await post(idToken, id, { text: 'Question' }).expect(201);
      generator.enqueue(
        FakePatientReplyGenerator.failAfter(['x']),
        FakePatientReplyGenerator.success('Fine'),
      );

      await replyOnce(idToken, id);
      const retry = await replyOnce(idToken, id);

      expect(retry.names().at(-1)).toBe('reply.completed');
      const items = (await list(idToken, id).expect(200)).body.items;
      expect(items.map((m: any) => m.role)).toEqual([
        'PATIENT',
        'THERAPIST',
        'PATIENT',
      ]);
    });

    it('fails with an error event after 15 s (here 0.7 s) without progress (AC-10)', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue({ steps: [{ type: 'stall' }] });

      const client = await replyOnce(idToken, id);

      expect(client.names()).toEqual(['reply.started', 'error']);
      expect(client.events()[1].data.type).toBe(
        '/problems/reply-generation-failed',
      );
      expect(client.isEnded).toBe(true);
      expect(await patientRows(id)).toBe(0);
    });

    it('fails a 2,501 character reply and stores a 2,500 character one (AC-11)', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue(FakePatientReplyGenerator.success('a'.repeat(2501)));

      const tooLong = await replyOnce(idToken, id);

      expect(tooLong.names().at(-1)).toBe('error');
      expect(await patientRows(id)).toBe(0);

      generator.enqueue(FakePatientReplyGenerator.success('a'.repeat(2500)));
      const exact = await replyOnce(idToken, id);

      expect(exact.names().at(-1)).toBe('reply.completed');
      expect(exact.events().at(-1)!.data.message.text).toHaveLength(2500);
      expect(await patientRows(id)).toBe(1);
    });
  });

  describe('cancellation (AC-8, AC-13)', () => {
    it('a dropped connection cancels the generation, stores nothing, and a new request stores exactly one reply', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      const abortedBefore = generator.aborted;
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));

      const client = await openReply(idToken, id);
      await client.until((f) => f.some((x) => x.event === 'reply.delta'));
      client.close();
      await waitFor(() => generator.aborted > abortedBefore);

      expect(await patientRows(id)).toBe(0);
      expect((await list(idToken, id)).body.items).toEqual([]);

      generator.enqueue(FakePatientReplyGenerator.success('Hello'));
      const again = await replyOnce(idToken, id);
      expect(again.names().at(-1)).toBe('reply.completed');
      expect(await patientRows(id)).toBe(1);
    });

    it('ending the session while streaming terminates the stream without completing or storing', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));
      const client = await openReply(idToken, id);
      await client.until((f) => f.some((x) => x.event === 'reply.delta'));

      await auth(request(server()).patch(`${SESSIONS}/${id}`), idToken)
        .send({ status: 'ENDED_BY_THERAPIST' })
        .expect(200);
      await client.finished();

      expect(client.isEnded).toBe(true);
      expect(client.names()).toEqual(['reply.started', 'reply.delta']);
      expect(await patientRows(id)).toBe(0);
    });

    it('discarding the session while streaming terminates the stream', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      generator.enqueue(FakePatientReplyGenerator.stallAfter('Par'));
      const client = await openReply(idToken, id);
      await client.until((f) => f.some((x) => x.event === 'reply.delta'));

      await auth(request(server()).delete(`${SESSIONS}/${id}`), idToken).expect(
        204,
      );
      await client.finished();

      expect(client.names()).toEqual(['reply.started', 'reply.delta']);
      expect(
        Number(
          (
            await sql(
              'SELECT count(*) FROM chat_simulation.messages WHERE session_id = $1',
              [id],
            )
          )[0].count,
        ),
      ).toBe(0);
    });
  });

  describe('privacy (AC-14)', () => {
    it('logs flow ids and counts but never message text, provider text, agent or remote ids', async () => {
      const { idToken } = await newUser();
      const id = await startSession(idToken);
      const lines: string[] = [];
      // Raw stdout/stderr writes too, in case something bypasses Logger.
      const capture = (chunk: unknown): boolean => {
        lines.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      };
      const rawSpies = [
        jest.spyOn(process.stdout, 'write').mockImplementation(capture),
        jest.spyOn(process.stderr, 'write').mockImplementation(capture),
      ];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) =>
          jest
            .spyOn(Logger.prototype, level)
            .mockImplementation((...args: unknown[]) => {
              const m = args[0];
              lines.push(typeof m === 'string' ? m : JSON.stringify(m));
            }),
      );
      try {
        generator.enqueue({
          steps: [
            { type: 'remote-session', openaiSessionId: 'remote-secret-marker' },
            { type: 'text', text: 'MARKER-PATIENT-REPLY-77' },
          ],
        });
        await replyOnce(idToken, id);
        await post(idToken, id, { text: 'MARKER-THERAPIST-TEXT-42' }).expect(
          201,
        );
        generator.enqueue(
          FakePatientReplyGenerator.failAfter(
            ['MARKER-PARTIAL-91'],
            new ReplyGenerationFailedError('MARKER-PROVIDER-MESSAGE-13'),
          ),
        );
        await replyOnce(idToken, id);
        await post(idToken, id, { text: '   ' }).expect(400);
        await list(idToken, id).expect(200);
      } finally {
        spies.forEach((s) => s.mockRestore());
        rawSpies.forEach((s) => s.mockRestore());
      }

      const logged = lines.join('\n');
      expect(logged).toContain('patient_reply_stream');
      expect(logged).toContain('flow_id');
      for (const marker of [
        'MARKER-PATIENT-REPLY-77',
        'MARKER-THERAPIST-TEXT-42',
        'MARKER-PARTIAL-91',
        'MARKER-PROVIDER-MESSAGE-13',
        'remote-secret-marker',
        'agent-secret',
        idToken,
      ]) {
        expect(logged).not.toContain(marker);
      }
    });
  });
});
