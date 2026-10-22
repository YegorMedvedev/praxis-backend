import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { App } from 'supertest/types';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';
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
const CONSENT = { terms_version: 'T1', privacy_version: 'P1' };

describe('Application (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const newUser = () => emulator.signUp(`user${++userCount}@example.test`);

  async function createApp(trustProxyHops: number) {
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.FIREBASE_PROJECT_ID = EMULATOR_PROJECT_ID;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = emulator.host;
    process.env.CONSENT_TERMS_VERSIONS = 'T1,T2';
    process.env.CONSENT_PRIVACY_VERSIONS = 'P1,P2';

    // Migrations are never auto-run by the app; apply them explicitly.
    const migrator = await new DataSource({
      type: 'postgres',
      url: postgres.getConnectionUri(),
      migrations: [CreateUsersProfiles1760000000000],
    }).initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    // Imported after the env is set: config is read when the module loads.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
