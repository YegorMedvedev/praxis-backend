import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
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
import { ProbeController } from './support/probe.controller';

const PROBE = '/api/v1/probe';

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
      controllers: [ProbeController],
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

    // Imported after the env is set: config is read when the module loads.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
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
        .post(PROBE)
        .expect(405)
        .expect('Allow', 'GET, PUT')
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/invalid-request');
      expect(response.body.status).toBe(405);
    });

    it('rejects a non-JSON body with 415', async () => {
      const { idToken } = await newUser();

      const response = await request(server())
        .put(PROBE)
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
        .put(PROBE)
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
        .put(PROBE)
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
      const { idToken, uid } = await newUser();

      const response = await request(server())
        .get(PROBE)
        .set('Authorization', `Bearer ${idToken}`)
        .expect(200);

      expect(response.body.uid).toBe(uid);
      expect(response.body.email).toMatch(/@example\.test$/);
    });

    it('answers a missing header with 401 and WWW-Authenticate', async () => {
      const response = await request(server())
        .get(PROBE)
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
        .get(PROBE)
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

      const missing = await request(server()).get(PROBE).set(flow).expect(401);
      const expiredResponse = await request(server())
        .get(PROBE)
        .set(flow)
        .set('Authorization', `Bearer ${expired}`)
        .expect(401)
        .expect('WWW-Authenticate', 'Bearer');
      const garbage = await request(server())
        .get(PROBE)
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
        .get(PROBE)
        .set('Authorization', `Bearer ${idToken}`)
        .set('X-Flow-ID', 'abc-123')
        .expect(200)
        .expect('X-Flow-ID', 'abc-123');

      const error = await request(server())
        .get(PROBE)
        .set('X-Flow-ID', 'abc-123')
        .expect(401)
        .expect('X-Flow-ID', 'abc-123');
      expect(error.body.flow_id).toBe('abc-123');
    });

    it('generates an id when absent or invalid', async () => {
      const absent = await request(server()).get(PROBE).expect(401);
      const invalid = await request(server())
        .get(PROBE)
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
        request(server()).get(PROBE).set('Authorization', `Bearer ${idToken}`);

      for (let i = 0; i < 60; i++) {
        await call().expect(200);
      }
      const response = await call()
        .expect(429)
        .expect('Content-Type', /application\/problem\+json/);

      expect(response.body.type).toBe('/problems/rate-limited');
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);

      const other = await newUser();
      await request(server())
        .get(PROBE)
        .set('Authorization', `Bearer ${other.idToken}`)
        .expect(200);
    });
  });

  describe('client IP for the failed-auth rate limit', () => {
    const hammer = async (target: INestApplication<App>) => {
      const statuses: number[] = [];
      for (let i = 0; i < 61; i++) {
        const response = await request(target.getHttpServer())
          .get(PROBE)
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
      const spy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          lines.push(String(message));
        });
      const { idToken } = await newUser();

      try {
        await request(server())
          .put(`${PROBE}?email=leak@example.test`)
          .set('Authorization', `Bearer ${idToken}`)
          .set('X-Flow-ID', 'log-flow')
          .send({ name: 'Elena Secretname', password: 'hunter2hunter2' })
          .expect(200);
      } finally {
        spy.mockRestore();
      }

      const output = lines.join('\n');
      expect(output).toContain('"flow_id":"log-flow"');
      expect(output).toContain(`"route":"${PROBE}"`);
      expect(output).toContain('"method":"PUT"');
      expect(output).toContain('"status":200');
      for (const secret of [
        idToken,
        'leak@example.test',
        'Elena Secretname',
        'hunter2hunter2',
        'user',
      ]) {
        expect(output).not.toContain(secret);
      }
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
