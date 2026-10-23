import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types';
import { InMemoryPasswordResetMailer } from '../../src/modules/auth/application/fakes';
import {
  PASSWORD_RESET_BACKGROUND_RUNNER,
  PASSWORD_RESET_MAILER,
  PASSWORD_RESET_RATE_LIMITER,
} from '../../src/modules/auth/auth.tokens';
import type { InProcessBackgroundRunner } from '../../src/modules/auth/infrastructure/in-process-background-runner';
import { RateLimiter } from '../../src/platform/http/rate-limiter';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';
import { AddCaseTranslationAgentId1760000002000 } from '../../src/platform/database/migrations/1760000002000-AddCaseTranslationAgentId';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';
import {
  applyTrustProxy,
  configureApp,
} from '../../src/platform/http/configure-app';
import {
  craftEmulatorToken,
  EMULATOR_PROJECT_ID,
  startFirebaseEmulator,
  type FirebaseEmulator,
} from './support/firebase-emulator';

const ME = '/api/v1/me';
const PASSWORD_RESET = '/api/v1/auth/password-reset';
const APP_BASE_URL = 'http://app.example.test';
const RESEND_API_KEY = 're_e2e_fake_key_do_not_leak';
const CONSENT = { terms_version: 'T1', privacy_version: 'P1' };

describe('Application (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const newUser = () => emulator.signUp(`user${++userCount}@example.test`);

  const mailer = new InMemoryPasswordResetMailer();

  async function createApp(trustProxyHops: number, resetLimiter?: RateLimiter) {
    const { AppModule } = await import('../../src/app.module');
    let builder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PASSWORD_RESET_MAILER)
      .useValue(mailer);
    if (resetLimiter) {
      builder = builder
        .overrideProvider(PASSWORD_RESET_RATE_LIMITER)
        .useValue(resetLimiter);
    }
    const moduleRef = await builder.compile();
    const instance = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(instance);
    applyTrustProxy(instance, trustProxyHops);
    await instance.init();
    return instance;
  }

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
    process.env.CONSENT_TERMS_VERSIONS = 'T1,T2';
    process.env.CONSENT_PRIVACY_VERSIONS = 'P1,P2';
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.test';
    process.env.APP_BASE_URL = APP_BASE_URL;
    process.env.RESEND_API_KEY = RESEND_API_KEY;
    process.env.PASSWORD_RESET_EMAIL_FROM = 'no-reply@mail.example.test';
    // Generous here; the 429 test builds its own app with a small limiter.
    process.env.PASSWORD_RESET_RATE_LIMIT = '1000';

    // Migrations are never auto-run by the app; apply them explicitly.
    const migrator = await new DataSource({
      type: 'postgres',
      url: postgres.getConnectionUri(),
      migrations: [
        CreateUsersProfiles1760000000000,
        CreateCaseLibrary1760000001000,
        AddCaseTranslationAgentId1760000002000,
      ],
    }).initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    // Imported after the env is set: config is read when the module loads.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PASSWORD_RESET_MAILER)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  describe('framework errors', () => {
    it('answers an unknown route with a problem+json 404', async () => {
      const response = await request(server())
        .get('/api/v1/nope?x=1')
        .set('X-Flow-ID', 'flow-404')
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body).toEqual({
        type: '/problems/not-found',
        title: 'Not Found',
        status: 404,
        instance: '/api/v1/nope',
        flow_id: 'flow-404',
      });
    });

    it('answers an unsupported method with 405 and Allow', async () => {
      const response = await request(server())
        .post(ME)
        .expect(405)
        .expect('Allow', 'GET, PUT')
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.status).toBe(405);
    });

    it('rejects a non-JSON body with 415', async () => {
      const { idToken } = await newUser();

      const response = await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'text/plain')
        .send('hello')
        .expect(415)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.status).toBe(415);
    });

    it('rejects a body over 8 KiB with 413', async () => {
      const { idToken } = await newUser();

      const response = await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(9000) }))
        .expect(413)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.status).toBe(413);
    });

    it('rejects malformed JSON with 400 without echoing the body', async () => {
      const { idToken } = await newUser();

      const response = await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'application/json')
        .send('{"secret-value": ')
        .expect(400);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(JSON.stringify(response.body)).not.toContain('secret-value');
    });
  });

  describe('authentication', () => {
    it('accepts a valid emulator token', async () => {
      const { idToken } = await newUser();

      // Authenticated, but this user has no profile yet.
      const response = await request(server())
        .get(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .expect(404);

      expect(response.body.type).toBe('/problems/profile-not-found');
    });

    it('answers a missing header with 401 and WWW-Authenticate', async () => {
      const response = await request(server())
        .get(ME)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer')
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/unauthenticated');
    });

    it('rejects a token issued for another Firebase project (AC-3)', async () => {
      const crafted = craftEmulatorToken({
        projectId: 'some-other-project',
        uid: 'intruder',
        email: 'i@example.test',
        expiresInSeconds: 3600,
      });

      const response = await request(server())
        .get(ME)
        .set('Authorization', `Bearer ${crafted}`)
        .expect(401);

      expect(response.body.type).toBe('/problems/unauthenticated');
    });

    it('answers missing, expired and bad tokens with bodies differing only in type (AC-16)', async () => {
      const expired = craftEmulatorToken({
        projectId: EMULATOR_PROJECT_ID,
        uid: 'someone',
        email: 'e@example.test',
        expiresInSeconds: -60,
      });
      const flow = { 'X-Flow-ID': 'same-flow' };

      const missing = await request(server()).get(ME).set(flow).expect(401);
      const expiredResponse = await request(server())
        .get(ME)
        .set(flow)
        .set('Authorization', `Bearer ${expired}`)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer');
      const garbage = await request(server())
        .get(ME)
        .set(flow)
        .set('Authorization', 'Bearer not.a.token')
        .expect(401);

      expect(missing.body.type).toBe('/problems/unauthenticated');
      expect(expiredResponse.body.type).toBe('/problems/token-expired');
      expect(garbage.body.type).toBe('/problems/unauthenticated');
      const withoutType = ({ type: _type, ...rest }: Record<string, unknown>) =>
        rest;
      expect(withoutType(expiredResponse.body)).toEqual(
        withoutType(missing.body),
      );
      expect(withoutType(garbage.body)).toEqual(withoutType(missing.body));
    });
  });

  describe('CORS', () => {
    const ORIGIN = 'https://app.example.test';

    it('answers a preflight without a token for an allowed origin', async () => {
      const response = await request(server())
        .options('/api/v1/me')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'PUT')
        .set('Access-Control-Request-Headers', 'authorization,content-type')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(response.headers['access-control-allow-methods']).toContain('PUT');
      expect(
        response.headers['access-control-allow-headers']?.toLowerCase(),
      ).toContain('authorization');
      expect(response.headers['access-control-max-age']).toBe('600');
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
    });

    it('adds CORS headers to real responses, including errors', async () => {
      const response = await request(server())
        .get('/api/v1/me')
        .set('Origin', ORIGIN)
        .expect(401);

      expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(response.headers['access-control-expose-headers']).toContain(
        'X-Flow-ID',
      );
      expect(response.headers.vary).toContain('Origin');
    });

    it('sends no CORS headers to a disallowed origin', async () => {
      const response = await request(server())
        .options('/api/v1/me')
        .set('Origin', 'https://evil.example.test')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('X-Flow-ID (AC-12)', () => {
    it('echoes a valid id on success and on error', async () => {
      const { idToken } = await newUser();

      await request(server())
        .get(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('X-Flow-ID', 'abc-123')
        .expect(404)
        .expect('X-Flow-ID', 'abc-123');

      const error = await request(server())
        .get(ME)
        .set('X-Flow-ID', 'abc-123')
        .expect(401)
        .expect('X-Flow-ID', 'abc-123');
      expect(error.body.flow_id).toBe('abc-123');
    });

    it('generates an id when absent or invalid', async () => {
      const absent = await request(server()).get(ME).expect(401);
      const invalid = await request(server())
        .get(ME)
        .set('X-Flow-ID', 'bad id!')
        .expect(401);

      expect(absent.headers['x-flow-id']).toBeTruthy();
      expect(absent.body.flow_id).toBe(absent.headers['x-flow-id']);
      expect(invalid.headers['x-flow-id']).not.toBe('bad id!');
      expect(invalid.body.flow_id).toBe(invalid.headers['x-flow-id']);
    });
  });

  describe('rate limiting (AC-13)', () => {
    it('answers the 61st request in a minute with 429 and Retry-After', async () => {
      const { idToken } = await newUser();
      const call = () =>
        request(server()).get(ME).set('Authorization', `Bearer ${idToken}`);

      for (let i = 0; i < 60; i++) {
        await call().expect(404);
      }
      const response = await call()
        .expect(429)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/rate-limited');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);

      const other = await newUser();
      await request(server())
        .get(ME)
        .set('Authorization', `Bearer ${other.idToken}`)
        .expect(404);
    });
  });

  describe('client IP for the failed-auth rate limit', () => {
    const hammer = async (target: INestApplication<App>) => {
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) {
        const response = await request(target.getHttpServer())
          .get(ME)
          .set('X-Forwarded-For', `203.0.113.${i + 1}`);
        statuses.push(response.status);
      }
      return statuses;
    };

    it('ignores X-Forwarded-For when no proxy is trusted', async () => {
      const untrusted = await createApp(0);
      try {
        const statuses = await hammer(untrusted);
        expect(statuses[60]).toBe(429);
      } finally {
        await untrusted.close();
      }
    });

    it('honours X-Forwarded-For with one trusted hop', async () => {
      const trusted = await createApp(1);
      try {
        const statuses = await hammer(trusted);
        expect(statuses.every((status) => status === 401)).toBe(true);
      } finally {
        await trusted.close();
      }
    });
  });

  describe('logging (AC-14)', () => {
    it('logs flow id and route template but no token, email or query', async () => {
      const lines: string[] = [];
      const capture = (...args: unknown[]) => {
        lines.push(String(args[0]));
      };
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(capture),
      );
      const { idToken } = await newUser();

      try {
        await request(server())
          .put(`${ME}?email=leak@example.test`)
          .set('Authorization', `Bearer ${idToken}`)
          .set('X-Flow-ID', 'log-flow')
          .send({
            name: 'Elena Secretname',
            consent: CONSENT,
            password: 'hunter2hunter2',
          })
          .expect(201);
        await request(server())
          .put(ME)
          .set('Authorization', `Bearer ${idToken}`)
          .send({ name: 'S', consent: CONSENT })
          .expect(400);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }

      const output = lines.join('\n');
      expect(output).toContain('"flow_id":"log-flow"');
      expect(output).toContain(`"route":"${ME}"`);
      expect(output).toContain('"method":"PUT"');
      expect(output).toContain('"status":201');
      expect(output).toContain('"status":400');
      for (const secret of [
        idToken,
        'leak@example.test',
        'Elena Secretname',
        'hunter2hunter2',
        '@example.test',
      ]) {
        expect(output).not.toContain(secret);
      }
    });
  });

  describe('password reset request', () => {
    const reset = (body: unknown) =>
      request(server())
        .post(PASSWORD_RESET)
        .send(body as object);
    // The work runs after the 202; wait for it deterministically (no sleeps).
    const flush = () =>
      app
        .get<InProcessBackgroundRunner>(PASSWORD_RESET_BACKGROUND_RUNNER, {
          strict: false,
        })
        .idle();
    const captureLogs = () => {
      const lines: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) =>
          jest
            .spyOn(Logger.prototype, level)
            .mockImplementation((...args: unknown[]) => {
              lines.push(args.map(String).join(' '));
            }),
      );
      return {
        lines,
        restore: () => spies.forEach((spy) => spy.mockRestore()),
      };
    };

    beforeEach(async () => {
      await flush();
      mailer.sent.length = 0;
      mailer.failWith = undefined;
    });

    it('answers 202 identically for a known and an unknown address, without a token', async () => {
      const email = `known${++userCount}@example.test`;
      await emulator.signUp(email);

      const known = await reset({ email })
        .set('X-Flow-ID', 'reset-flow')
        .expect(202)
        .expect('Cache-Control', 'no-store')
        .expect('X-Flow-ID', 'reset-flow');
      const unknown = await reset({ email: 'nobody-at-all@example.test' })
        .set('X-Flow-ID', 'reset-flow')
        .expect(202)
        .expect('Cache-Control', 'no-store')
        .expect('X-Flow-ID', 'reset-flow');

      await flush();
      expect(known.text).toBe('');
      expect(unknown.text).toBe(known.text);
      const strip = (headers: Record<string, unknown>) => {
        const { date: _date, etag: _etag, ...rest } = headers;
        return rest;
      };
      expect(strip(unknown.headers)).toEqual(strip(known.headers));
    });

    it('mails exactly one message with the app link for a known address', async () => {
      const email = `known${++userCount}@example.test`;
      await emulator.signUp(email);

      await reset({ email, language: 'ru' }).expect(202);
      await flush();

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({ to: email, language: 'ru' });
      expect(mailer.sent[0].link).toMatch(
        new RegExp(
          `^${APP_BASE_URL}/auth-action\\?mode=resetPassword&oobCode=[^&]+&lang=ru$`,
        ),
      );
    });

    it('defaults to English and ignores any Host header for the link', async () => {
      const email = `known${++userCount}@example.test`;
      await emulator.signUp(email);

      await reset({ email })
        .set('Host', 'evil.example')
        .set('X-Forwarded-Host', 'evil2.example')
        .expect(202);
      await flush();

      expect(mailer.sent[0].language).toBe('en');
      expect(
        mailer.sent[0].link.startsWith(`${APP_BASE_URL}/auth-action?`),
      ).toBe(true);
      expect(mailer.sent[0].link).toContain('lang=en');
      expect(mailer.sent[0].link).not.toContain('evil.example');
      expect(mailer.sent[0].link).not.toContain('evil2.example');
    });

    it('sends nothing for an unknown address', async () => {
      await reset({ email: 'ghost@example.test' }).expect(202);
      await flush();

      expect(mailer.sent).toEqual([]);
    });

    it('answers 202 even if the mailer fails', async () => {
      const email = `known${++userCount}@example.test`;
      await emulator.signUp(email);
      mailer.failWith = new Error('Resend is down');

      const response = await reset({ email }).expect(202);
      await flush();

      expect(response.text).toBe('');
    });

    it.each([
      [{}, 'email', 'REQUIRED'],
      [{ email: 42 }, 'email', 'INVALID_TYPE'],
      [{ email: 'not-an-email' }, 'email', 'INVALID_VALUE'],
      [{ email: `${'a'.repeat(250)}@e.co` }, 'email', 'TOO_LONG'],
      [
        { email: 'a@example.test', language: 'de' },
        'language',
        'INVALID_VALUE',
      ],
    ])(
      'rejects body %j with 400 invalid-request',
      async (body, name, reason) => {
        const response = await reset(body)
          .expect(400)
          .expect('Content-Type', /application\/problem\+json/);

        expect(response.body.type).toBe('/problems/invalid-request');
        expect(response.body.invalid_params).toEqual([{ name, reason }]);
        expect(mailer.sent).toEqual([]);
      },
    );

    it('never logs the address, link, oobCode or API key', async () => {
      const email = `loggable${++userCount}@example.test`;
      await emulator.signUp(email);
      const logs = captureLogs();
      mailer.failWith = new Error(`${email} ${RESEND_API_KEY}`);

      try {
        await reset({ email }).expect(202);
        await flush();
        mailer.failWith = undefined;
        await reset({ email }).expect(202);
        await reset({ email: 'unknown-logged@example.test' }).expect(202);
        await reset({ email: 'invalid' }).expect(400);
        await flush();
      } finally {
        logs.restore();
      }

      const output = logs.lines.join('\n');
      expect(output).toContain('password_reset_failed');
      expect(output).toContain('"route":"/api/v1/auth/password-reset"');
      const oobCode = new URL(mailer.sent[0].link).searchParams.get('oobCode');
      for (const secret of [
        email,
        'unknown-logged@example.test',
        '@example.test',
        mailer.sent[0].link,
        oobCode ?? 'missing-oob-code',
        RESEND_API_KEY,
      ]) {
        expect(output).not.toContain(secret);
      }
    });

    it('silently stops mailing one address after 3 requests (never a 429)', async () => {
      const email = `throttled${++userCount}@example.test`;
      await emulator.signUp(email);
      const logs = captureLogs();

      try {
        for (let i = 0; i < 5; i++) {
          await reset({ email: i % 2 ? email.toUpperCase() : email }).expect(
            202,
          );
          await flush();
        }
      } finally {
        logs.restore();
      }

      expect(mailer.sent).toHaveLength(3);
      const output = logs.lines.join('\n');
      expect(output).toContain('"stage":"throttled"');
      expect(output).not.toContain(email);
    });

    it('limits the route per client IP with 429 and Retry-After', async () => {
      const limited = await createApp(
        0,
        new RateLimiter(
          { now: () => new Date() },
          { limit: 3, windowMs: 60_000 },
        ),
      );
      try {
        const call = () =>
          request(limited.getHttpServer())
            .post(PASSWORD_RESET)
            .send({ email: 'ghost@example.test' });
        for (let i = 0; i < 3; i++) await call().expect(202);

        const response = await call()
          .expect(429)
          .expect('Content-Type', /application\/problem\+json/);

        expect(response.body.type).toBe('/problems/rate-limited');
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        // The other routes keep their own (global) budget.
        await request(limited.getHttpServer()).get(ME).expect(401);
      } finally {
        await limited.close();
      }
    });
  });

  describe('/me', () => {
    const put = (idToken: string, body: unknown) =>
      request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .send(body as object);
    const get = (idToken: string) =>
      request(server()).get(ME).set('Authorization', `Bearer ${idToken}`);

    it('creates a profile and reads it back (AC-7, AC-1)', async () => {
      const { idToken, uid } = await newUser();
      const email = `user${userCount}@example.test`;
      const before = Date.now();

      const created = await put(idToken, {
        name: '  Elena  ',
        consent: CONSENT,
      })
        .expect(201)
        .expect('Location', ME)
        .expect('Cache-Control', 'no-store')
        .expect('Content-Type', /application\/json/);

      expect(created.headers['x-flow-id']).toBeTruthy();
      expect(created.body).toEqual({
        id: uid,
        name: 'Elena',
        email,
        consent: {
          terms_version: 'T1',
          privacy_version: 'P1',
          accepted_at: expect.any(String),
        },
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      const acceptedAt = Date.parse(created.body.consent.accepted_at);
      expect(acceptedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(acceptedAt).toBeLessThanOrEqual(Date.now() + 1000);

      const read = await get(idToken)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      expect(read.body).toEqual(created.body);
    });

    it('answers 404 profile-not-found with no-store (AC-6)', async () => {
      const { idToken } = await newUser();
      const response = await get(idToken)
        .expect(404)
        .expect('Cache-Control', 'no-store')
        .expect('Content-Type', /application\/problem\+json/);
      expect(response.body.type).toBe('/problems/profile-not-found');
    });

    it('requires authentication on both methods (AC-2)', async () => {
      await request(server())
        .get(ME)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer');
      await request(server()).put(ME).send({}).expect(401);
    });

    it('rejects a missing or unknown consent on create (AC-8)', async () => {
      const { idToken } = await newUser();

      const missing = await put(idToken, { name: 'Elena' }).expect(400);
      expect(missing.body.type).toBe('/problems/invalid-request');
      expect(missing.body.invalid_params).toEqual([
        { name: 'consent', reason: 'REQUIRED' },
      ]);

      const unknown = await put(idToken, {
        name: 'Elena',
        consent: { terms_version: 'T9', privacy_version: 'P1' },
      }).expect(400);
      expect(unknown.body.invalid_params).toEqual([
        { name: 'consent.terms_version', reason: 'UNKNOWN_VERSION' },
      ]);

      await get(idToken).expect(404);
    });

    it('is idempotent with an identical body (AC-9)', async () => {
      const { idToken } = await newUser();
      const body = { name: 'Elena', consent: CONSENT };

      const first = await put(idToken, body).expect(201);
      const second = await put(idToken, body)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(second.headers.location).toBeUndefined();
      expect(second.body).toEqual(first.body);
    });

    it('replaces the name without consent and re-records a changed pair', async () => {
      const { idToken } = await newUser();
      const first = await put(idToken, {
        name: 'Elena',
        consent: CONSENT,
      }).expect(201);

      const renamed = await put(idToken, { name: 'Elena B' }).expect(200);
      expect(renamed.body.name).toBe('Elena B');
      expect(renamed.body.consent).toEqual(first.body.consent);
      expect(renamed.body.created_at).toBe(first.body.created_at);

      await new Promise((resolve) => setTimeout(resolve, 20));
      const reaccepted = await put(idToken, {
        name: 'Elena B',
        consent: { terms_version: 'T2', privacy_version: 'P1' },
      }).expect(200);
      expect(reaccepted.body.consent.terms_version).toBe('T2');
      expect(Date.parse(reaccepted.body.consent.accepted_at)).toBeGreaterThan(
        Date.parse(first.body.consent.accepted_at),
      );
    });

    it.each([
      [{ name: 'A', consent: CONSENT }, 'TOO_SHORT'],
      [{ consent: CONSENT }, 'REQUIRED'],
      [{}, 'REQUIRED'],
      [{ name: 'x'.repeat(101), consent: CONSENT }, 'TOO_LONG'],
      [{ name: '   ', consent: CONSENT }, 'REQUIRED'],
      [{ name: 7, consent: CONSENT }, 'INVALID_TYPE'],
    ])('rejects an invalid name %j (AC-10)', async (body, reason) => {
      const { idToken } = await newUser();
      const response = await put(idToken, body)
        .expect(400)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.invalid_params).toContainEqual({
        name: 'name',
        reason,
      });
      expect(response.body).not.toHaveProperty('errors');
    });

    it('rejects a wrongly typed consent', async () => {
      const { idToken } = await newUser();
      const response = await put(idToken, {
        name: 'Elena',
        consent: 'yes',
      }).expect(400);
      expect(response.body.invalid_params).toEqual([
        { name: 'consent', reason: 'INVALID_TYPE' },
      ]);
    });

    it('ignores unknown and read-only properties (AC-11)', async () => {
      const { idToken, uid } = await newUser();
      const email = `user${userCount}@example.test`;

      const response = await put(idToken, {
        name: 'Elena',
        consent: CONSENT,
        email: 'x@y.z',
        id: 'other',
        created_at: '2000-01-01T00:00:00Z',
        foo: 1,
      }).expect(201);

      expect(response.body.id).toBe(uid);
      expect(response.body.email).toBe(email);
      expect(response.body.created_at).not.toBe('2000-01-01T00:00:00Z');
      expect(response.body).not.toHaveProperty('foo');
    });

    it('answers 413 and 415 on /me with no-store', async () => {
      const { idToken } = await newUser();
      await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'text/plain')
        .send('hello')
        .expect(415)
        .expect('Cache-Control', 'no-store');
      await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(9000) }))
        .expect(413)
        .expect('Cache-Control', 'no-store');
    });

    it("does not leak or alter another user's profile", async () => {
      const a = await newUser();
      const b = await newUser();
      const created = await put(a.idToken, {
        name: 'Alice A',
        consent: CONSENT,
      }).expect(201);

      await get(b.idToken).expect(404);
      const bCreated = await put(b.idToken, {
        name: 'Bob B',
        consent: CONSENT,
        id: a.uid,
      }).expect(201);
      expect(bCreated.body.id).toBe(b.uid);

      const aAfter = await get(a.idToken).expect(200);
      expect(aAfter.body).toEqual(created.body);
    });

    it('lets exactly one of two concurrent first PUTs create (201) and the other replace (200)', async () => {
      const { idToken } = await newUser();
      const body = { name: 'Elena', consent: CONSENT };

      const responses = await Promise.all([
        put(idToken, body),
        put(idToken, body),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(responses[0].body.created_at).toBe(responses[1].body.created_at);
      expect(responses[0].body.consent.accepted_at).toBe(
        responses[1].body.consent.accepted_at,
      );
    });

    it.each([
      [
        { name: 'Elena', consent: null },
        [{ name: 'consent', reason: 'INVALID_TYPE' }],
      ],
      [
        { name: 'Elena', consent: {} },
        [
          { name: 'consent.terms_version', reason: 'REQUIRED' },
          { name: 'consent.privacy_version', reason: 'REQUIRED' },
        ],
      ],
      [
        { name: 'Elena', consent: { terms_version: 1, privacy_version: true } },
        [
          { name: 'consent.terms_version', reason: 'INVALID_TYPE' },
          { name: 'consent.privacy_version', reason: 'INVALID_TYPE' },
        ],
      ],
    ])('rejects malformed consent %j', async (body, params) => {
      const { idToken } = await newUser();
      const response = await put(idToken, body).expect(400);
      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.invalid_params).toEqual(params);
    });

    it('rejects a name with a NUL or control character instead of failing (500)', async () => {
      const { idToken } = await newUser();
      const response = await put(idToken, {
        name: 'El\u0000ena',
        consent: CONSENT,
      }).expect(400);
      expect(response.body.invalid_params).toEqual([
        { name: 'name', reason: 'INVALID_VALUE' },
      ]);
    });

    it('rejects a JSON body that is not an object', async () => {
      const { idToken } = await newUser();
      const response = await request(server())
        .put(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .set('Content-Type', 'application/json')
        .send('"just a string"');
      expect(response.status).toBe(400);
      expect(response.body.type).toBe('/problems/invalid-request');
    });

    it('answers an unsupported method with 405 and Allow (AC-15)', async () => {
      const { idToken } = await newUser();
      await request(server())
        .post(ME)
        .set('Authorization', `Bearer ${idToken}`)
        .expect(405)
        .expect('Allow', 'GET, PUT');
    });

    it('publishes /me in the OpenAPI document', async () => {
      const response = await request(server())
        .get('/api/v1/docs-json')
        .expect(200);
      const path = response.body.paths['/api/v1/me'];
      expect(Object.keys(path).sort()).toEqual(['get', 'put']);
      expect(Object.keys(path.put.responses)).toEqual(
        expect.arrayContaining(['200', '201', '400', '401', '403', '429']),
      );
    });
  });

  it('serves the OpenAPI document with the global bearer scheme', async () => {
    const response = await request(server())
      .get('/api/v1/docs-json')
      .expect(200);

    expect(response.body.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(response.body.security).toEqual([{ bearerAuth: [] }]);
  });
});
