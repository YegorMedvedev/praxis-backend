import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// `ts` under ts-node, `js` from compiled output (which also holds `.d.ts` files).
const ext = extname(__filename).slice(1);

/**
 * Used by the TypeORM CLI (`pnpm migration:*`); the app uses DatabaseModule.
 * Globs are relative to this file so the same source works from `src` (ts-node)
 * and from compiled `dist` (`pnpm migration:run:prod`, no dev dependencies).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [
    join(__dirname, `../../modules/*/infrastructure/**/*.orm-entity.${ext}`),
  ],
  migrations: [join(__dirname, `migrations/*.${ext}`)],
  synchronize: false,
});
