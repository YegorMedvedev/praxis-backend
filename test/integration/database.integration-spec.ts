import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

describe('PostgreSQL (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    dataSource = await new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      synchronize: false,
    }).initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  it('connects with synchronize disabled', async () => {
    expect(dataSource.options.synchronize).toBe(false);
    await expect(dataSource.query('SELECT 1 AS ok')).resolves.toEqual([
      { ok: 1 },
    ]);
  });
});
