import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/** Used by the TypeORM CLI (`pnpm migration:*`); the app uses DatabaseModule. */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/modules/*/infrastructure/**/*.orm-entity.ts'],
  migrations: ['src/platform/database/migrations/*.ts'],
  synchronize: false,
});
