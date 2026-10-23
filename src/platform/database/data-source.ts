import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/** Used by the TypeORM CLI (`pnpm migration:*`); the app uses DatabaseModule. */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['src/modules/*/infrastructure/**/*.orm-entity.ts'],
  migrations: ['src/platform/database/migrations/*.ts'],
  synchronize: false,
});
