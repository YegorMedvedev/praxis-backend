import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from '../../src/platform/http/configure-app';

describe('Application (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication<App>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.FIREBASE_PROJECT_ID = 'praxis-e2e-fake';

    // Imported after DATABASE_URL is set: config is read when the module loads.
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
    await container?.stop();
  });

  it('answers an unknown route with a problem+json 404', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/nope?x=1')
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body).toEqual({
      type: '/problems/not-found',
      title: 'Not Found',
      status: 404,
      instance: '/api/v1/nope',
    });
  });

  it('serves the OpenAPI document', async () => {
    await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
  });
});
