import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { RecordCaseCompletion as RecordCaseCompletionType } from '../../src/modules/case-library/case-library.public-api';
import type { SeedCase } from '../../src/modules/case-library/infrastructure/seed/case-seed.data';
import { seedCases } from '../../src/modules/case-library/infrastructure/seed/case-seeder';
import { AddCaseTranslationAgentId1760000002000 } from '../../src/platform/database/migrations/1760000002000-AddCaseTranslationAgentId';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';
import { CreateUsersProfiles1760000000000 } from '../../src/platform/database/migrations/1760000000000-CreateUsersProfiles';
import { configureApp } from '../../src/platform/http/configure-app';
import {
  EMULATOR_PROJECT_ID,
  startFirebaseEmulator,
  type FirebaseEmulator,
} from './support/firebase-emulator';

const CASES = '/api/v1/cases';

const content = (n: string, lang: 'en' | 'ru', note: boolean) => ({
  title: `Title ${n} ${lang}`,
  teaser: `Teaser ${n} ${lang}`,
  scenario: `Scenario ${n} ${lang}`,
  patientName: `Fictional ${n} ${lang}`,
  contentNote: note ? `Note ${n} ${lang}` : null,
});
const seedCase = (
  id: string,
  languages: ('en' | 'ru')[],
  note = false,
): SeedCase => ({
  id,
  level: 'HARD',
  category: 'TRAUMA_DISCLOSURE',
  avatar: 'OLDER_GREY',
  patientAge: 52,
  content: Object.fromEntries(languages.map((l) => [l, content(id, l, note)])),
});

const SUMMARY_KEYS = [
  'avatar',
  'category',
  'completed',
  'completed_at',
  'id',
  'level',
  'teaser',
  'title',
];
const DETAIL_KEYS = [
  ...SUMMARY_KEYS,
  'content_note',
  'patient',
  'scenario',
].sort();

describe('GET /cases and /cases/:case_id (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let record: RecordCaseCompletionType;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const newUser = () => emulator.signUp(`cases${++userCount}@example.test`);
  const get = (path: string, idToken: string, language?: string) => {
    const req = request(server())
      .get(path)
      .set('Authorization', `Bearer ${idToken}`);
    return language === undefined ? req : req.set('Accept-Language', language);
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
    process.env.PASSWORD_RESET_EMAIL_FROM = 'no-reply@mail.example.test';

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

    const { AppModule } = await import('../../src/app.module');
    const { RecordCaseCompletion } =
      await import('../../src/modules/case-library/case-library.public-api');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    record = app.get(RecordCaseCompletion, { strict: false });
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  const manager = () => app.get(DataSource, { strict: false }).manager;

  describe('empty catalog', () => {
    it('is 200 with no items on both routes shape', async () => {
      const { idToken } = await newUser();
      const response = await get(CASES, idToken).expect(200);
      expect(response.body).toEqual({ items: [] });
      await get(`${CASES}/anything`, idToken).expect(404);
    });
  });

  describe('with a catalog', () => {
    beforeAll(async () => {
      await seedCases(manager(), [
        seedCase('case-z', ['en', 'ru'], true),
        seedCase('case-a', ['en', 'ru']),
        seedCase('case-hidden', ['en']),
        seedCase('case-m', ['en', 'ru']),
      ]);
    });

    it.each(['/cases', '/cases/case-a'])(
      '401 without a token on %s',
      async (path) => {
        const response = await request(server())
          .get(`/api/v1${path}`)
          .expect(401)
          .expect('WWW-Authenticate', 'Bearer')
          .expect('Cache-Control', 'no-store')
          .expect('Content-Type', /application\/problem\+json/);
        expect(response.body.type).toBe('/problems/unauthenticated');
      },
    );

    it('lists visible cases in catalog order with exactly the summary keys', async () => {
      const { idToken } = await newUser();
      const response = await get(CASES, idToken)
        .expect(200)
        .expect('Content-Type', /application\/json/)
        .expect('Content-Language', 'en')
        .expect('Cache-Control', 'no-store');
      expect(response.headers['vary']).toMatch(/Accept-Language/i);
      expect(response.headers['x-flow-id']).toBeTruthy();

      expect(Object.keys(response.body)).toEqual(['items']);
      expect(response.body.items.map((i: { id: string }) => i.id)).toEqual([
        'case-z',
        'case-a',
        'case-m',
      ]);
      for (const item of response.body.items) {
        expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
        expect(item).toMatchObject({
          level: 'HARD',
          category: 'TRAUMA_DISCLOSURE',
          avatar: 'OLDER_GREY',
          completed: false,
          completed_at: null,
        });
      }
      expect(response.body.items[0]).toMatchObject({
        title: 'Title case-z en',
        teaser: 'Teaser case-z en',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /twist|persona|hidden|scenario|prompt|score|position/i,
      );
    });

    it('is stable across requests and users, and ignores unknown query params', async () => {
      const a = await newUser();
      const b = await newUser();
      const first = await get(CASES, a.idToken).expect(200);
      const again = await get(`${CASES}?foo=bar`, b.idToken).expect(200);
      expect(again.body).toEqual(first.body);
    });

    it('localizes by Accept-Language; absent or other values mean English', async () => {
      const { idToken } = await newUser();
      const ru = await get(CASES, idToken, 'ru').expect(200);
      expect(ru.headers['content-language']).toBe('ru');
      expect(ru.body.items[0].title).toBe('Title case-z ru');
      const rud = await get(`${CASES}/case-z`, idToken, 'ru-RU,en;q=0.5');
      expect(rud.headers['content-language']).toBe('ru');
      expect(rud.body.patient.name).toBe('Fictional case-z ru');

      for (const header of [undefined, 'en', 'de', 'fr-CA,de;q=0.5', '*']) {
        const response = await get(CASES, idToken, header).expect(200);
        expect(response.headers['content-language']).toBe('en');
        expect(response.body.items[0].title).toBe('Title case-z en');
      }
      const ruItems = ru.body.items.map((i: Record<string, unknown>) => ({
        level: i.level,
        category: i.category,
        avatar: i.avatar,
      }));
      const enItems = (await get(CASES, idToken, 'en')).body.items.map(
        (i: Record<string, unknown>) => ({
          level: i.level,
          category: i.category,
          avatar: i.avatar,
        }),
      );
      expect(ruItems).toEqual(enItems);
    });

    it('isolates completion per user on list and detail', async () => {
      const a = await newUser();
      const b = await newUser();
      await record.execute({ userId: a.uid, caseId: 'case-a' });

      const aList = (await get(CASES, a.idToken).expect(200)).body.items;
      const bList = (await get(CASES, b.idToken).expect(200)).body.items;
      const pick = (items: Record<string, unknown>[]) =>
        items.find((i) => i.id === 'case-a');
      expect(pick(aList)).toMatchObject({ completed: true });
      expect(typeof pick(aList)?.completed_at).toBe('string');
      expect(new Date(pick(aList)?.completed_at as string).toISOString()).toBe(
        pick(aList)?.completed_at,
      );
      expect(pick(bList)).toMatchObject({
        completed: false,
        completed_at: null,
      });

      const aDetail = await get(`${CASES}/case-a`, a.idToken).expect(200);
      const bDetail = await get(`${CASES}/case-a`, b.idToken).expect(200);
      expect(aDetail.body.completed).toBe(true);
      expect(bDetail.body).toMatchObject({
        completed: false,
        completed_at: null,
      });
    });

    it('returns the detail with exactly the documented keys', async () => {
      const { idToken } = await newUser();
      const response = await get(`${CASES}/case-z`, idToken)
        .expect(200)
        .expect('Content-Language', 'en')
        .expect('Cache-Control', 'no-store');
      expect(response.headers['vary']).toMatch(/Accept-Language/i);
      expect(response.headers['x-flow-id']).toBeTruthy();
      expect(Object.keys(response.body).sort()).toEqual(DETAIL_KEYS);
      expect(Object.keys(response.body.patient).sort()).toEqual([
        'age',
        'name',
      ]);
      expect(response.body).toMatchObject({
        scenario: 'Scenario case-z en',
        patient: { name: 'Fictional case-z en', age: 52 },
        content_note: 'Note case-z en',
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /twist|persona|background|prompt|score/i,
      );
    });

    it('has a null content_note when the case has none', async () => {
      const { idToken } = await newUser();
      const response = await get(`${CASES}/case-a`, idToken).expect(200);
      expect(response.body.content_note).toBeNull();
    });

    it('shares its summary fields with the list item (AC-5)', async () => {
      const user = await newUser();
      await record.execute({ userId: user.uid, caseId: 'case-m' });
      for (const language of ['en', 'ru']) {
        const list = (await get(CASES, user.idToken, language)).body.items;
        for (const item of list) {
          const detail = (
            await get(`${CASES}/${item.id}`, user.idToken, language)
          ).body;
          const shared = Object.fromEntries(
            SUMMARY_KEYS.map((k) => [k, detail[k]]),
          );
          expect(shared).toEqual(item);
        }
      }
    });

    it('ignores unknown query params on detail', async () => {
      const { idToken } = await newUser();
      const plain = await get(`${CASES}/case-a`, idToken).expect(200);
      const withParam = await get(`${CASES}/case-a?foo=bar`, idToken).expect(
        200,
      );
      expect(withParam.body).toEqual(plain.body);
    });

    it.each([
      ['unknown', 'does-not-exist'],
      ['hidden', 'case-hidden'],
      ['illegal characters', 'a\'b";--'],
      ['percent-encoded slash', 'a%2Fb'],
      ['percent-encoded NUL', 'a%00b'],
      ['bad percent escape', '%E0%A4%A'],
      ['lone percent', '%'],
      ['unicode', encodeURIComponent('дело-💥')],
      ['very long', 'x'.repeat(5000)],
      ['dots', '..'],
      ['uuid-like', '123e4567-e89b-12d3-a456-426614174000'],
    ])('404 case-not-found for %s id', async (_name, id) => {
      const { idToken } = await newUser();
      const response = await get(`${CASES}/${id}`, idToken)
        .expect(404)
        .expect('Content-Type', /application\/problem\+json/)
        .expect('Cache-Control', 'no-store');
      expect(response.body.type).toBe('/problems/case-not-found');
      expect(response.body.status).toBe(404);
      expect(response.body.flow_id).toBeTruthy();
    });

    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '%s on /cases and /cases/:id is 405 with Allow: GET',
      async (method) => {
        const { idToken } = await newUser();
        for (const path of [CASES, `${CASES}/case-a`]) {
          const response = await request(server())
            [method](path)
            .set('Authorization', `Bearer ${idToken}`)
            .expect(405)
            .expect('Allow', 'GET')
            .expect('Cache-Control', 'no-store')
            .expect('Content-Type', /application\/problem\+json/);
          expect(response.body.type).toBe('/problems/invalid-request');
        }
      },
    );

    it('has no completion sub-resource', async () => {
      const { idToken } = await newUser();
      await request(server())
        .put(`${CASES}/case-a/completion`)
        .set('Authorization', `Bearer ${idToken}`)
        .expect(404);
    });

    it('never logs case text, patient names or the Authorization value', async () => {
      const { idToken } = await newUser();
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
      try {
        await get(CASES, idToken, 'ru').expect(200);
        await get(`${CASES}/case-z`, idToken).expect(200);
        await get(`${CASES}/nope`, idToken).expect(404);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
      const logged = lines.join('\n');
      expect(logged).toContain('flow_id');
      expect(logged).not.toContain(idToken);
      expect(logged).not.toMatch(
        /Fictional|Title case|Teaser|Scenario|Note case/,
      );
    });

    it('never exposes a patient agent id, in either language', async () => {
      await seedCases(manager(), [
        {
          ...seedCase('case-agent', ['en', 'ru']),
          agentIds: { en: 'agent-secret-en-1', ru: 'agent-secret-ru-2' },
        },
      ]);
      const { idToken } = await newUser();
      for (const language of ['en', 'ru']) {
        const bodies = [
          await get(CASES, idToken, language).expect(200),
          await get(`${CASES}/case-agent`, idToken, language).expect(200),
        ];
        for (const response of bodies) {
          const text = JSON.stringify(response.body);
          expect(text).not.toContain('agent_id');
          expect(text).not.toContain('agentId');
          expect(text).not.toContain('agent-secret');
        }
      }
    });
  });
});
