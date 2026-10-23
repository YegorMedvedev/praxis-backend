import { INestApplication } from '@nestjs/common';
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

const PROGRESS = '/api/v1/me/case-progress';

const text = (title: string) => ({
  title,
  teaser: `${title} teaser`,
  scenario: `${title} scenario`,
  patientName: 'Placeholder Patient',
  contentNote: null,
});
const seedCase = (id: string, languages: ('en' | 'ru')[]): SeedCase => ({
  id,
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 30,
  content: Object.fromEntries(languages.map((l) => [l, text(`${id}-${l}`)])),
});

describe('GET /me/case-progress (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let emulator: FirebaseEmulator;
  let app: INestApplication<App>;
  let record: RecordCaseCompletionType;
  let userCount = 0;

  const server = () => app.getHttpServer();
  const newUser = () => emulator.signUp(`progress${++userCount}@example.test`);
  const progressOf = (idToken: string) =>
    request(server()).get(PROGRESS).set('Authorization', `Bearer ${idToken}`);

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

    // Three visible cases and one hidden (no Russian text).
    await seedCases(app.get(DataSource, { strict: false }).manager, [
      seedCase('case-a', ['en', 'ru']),
      seedCase('case-b', ['en', 'ru']),
      seedCase('case-c', ['en', 'ru']),
      seedCase('case-hidden', ['en']),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await postgres?.stop();
    await emulator?.container.stop();
  });

  it('requires a bearer token', async () => {
    const response = await request(server())
      .get(PROGRESS)
      .expect(401)
      .expect('WWW-Authenticate', 'Bearer')
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /application\/problem\+json/);
    expect(response.body.type).toBe('/problems/unauthenticated');
  });

  it('gives a new user 0 of the visible catalog, no-store, snake_case only', async () => {
    const { idToken } = await newUser();

    const response = await progressOf(idToken)
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /application\/json/);

    expect(response.headers['x-flow-id']).toBeTruthy();
    expect(response.body).toEqual({ completed_count: 0, total_count: 3 });
  });

  it('ignores unknown query parameters', async () => {
    const { idToken } = await newUser();
    const response = await request(server())
      .get(`${PROGRESS}?foo=bar`)
      .set('Authorization', `Bearer ${idToken}`)
      .expect(200);
    expect(response.body).toEqual({ completed_count: 0, total_count: 3 });
  });

  it('reflects completions recorded through the public-API use case, once per case', async () => {
    const user = await newUser();
    const uid = user.uid;

    await record.execute({ userId: uid, caseId: 'case-a' });
    await record.execute({ userId: uid, caseId: 'case-a' });
    await Promise.all([
      record.execute({ userId: uid, caseId: 'case-b' }),
      record.execute({ userId: uid, caseId: 'case-b' }),
    ]);

    const response = await progressOf(user.idToken).expect(200);
    expect(response.body).toEqual({ completed_count: 2, total_count: 3 });
  });

  it('never leaks one user completions to another', async () => {
    const a = await newUser();
    const b = await newUser();

    await record.execute({ userId: a.uid, caseId: 'case-c' });

    expect((await progressOf(a.idToken)).body.completed_count).toBe(1);
    expect((await progressOf(b.idToken)).body.completed_count).toBe(0);
  });

  it('excludes hidden and removed cases from both counts', async () => {
    const user = await newUser();
    await record.execute({ userId: user.uid, caseId: 'case-hidden' });
    await record.execute({ userId: user.uid, caseId: 'never-existed' });

    const response = await progressOf(user.idToken).expect(200);

    expect(response.body).toEqual({ completed_count: 0, total_count: 3 });
  });

  it('counts a case once it becomes visible and drops it when hidden again', async () => {
    const user = await newUser();
    await record.execute({ userId: user.uid, caseId: 'case-late' });
    const manager = app.get(DataSource, { strict: false }).manager;

    await seedCases(manager, [
      seedCase('case-a', ['en', 'ru']),
      seedCase('case-b', ['en', 'ru']),
      seedCase('case-c', ['en', 'ru']),
      seedCase('case-hidden', ['en']),
      seedCase('case-late', ['en', 'ru']),
    ]);
    expect((await progressOf(user.idToken)).body).toEqual({
      completed_count: 1,
      total_count: 4,
    });

    await manager.query(
      `DELETE FROM case_library.cases WHERE id = 'case-late'`,
    );
    expect((await progressOf(user.idToken)).body).toEqual({
      completed_count: 0,
      total_count: 3,
    });
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'answers %s with 405 and Allow: GET',
    async (method) => {
      const { idToken } = await newUser();
      const response = await request(server())
        [method](PROGRESS)
        .set('Authorization', `Bearer ${idToken}`)
        .expect(405)
        .expect('Allow', 'GET')
        .expect('Cache-Control', 'no-store')
        .expect('Content-Type', /application\/problem\+json/);
      expect(response.body.type).toBe('/problems/invalid-request');
    },
  );
});
