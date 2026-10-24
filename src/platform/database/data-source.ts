import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';

// ENV_FILE selects exactly one env file (e.g. ENV_FILE=.env.staging) and it must exist,
// so a missing file never silently falls back to the local `.env`.
const envFile = process.env.ENV_FILE;
if (envFile) {
  if (!existsSync(envFile)) {
    throw new Error(`ENV_FILE ${envFile} does not exist`);
  }
  process.loadEnvFile(envFile);
} else if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// `ts` under ts-node, `js` from compiled output (which also holds `.d.ts` files).
const ext = extname(__filename).slice(1);

// Set DB_SSL=true for hosts that require TLS (e.g. Render's external database URL). The
// certificate is not verified, like `sslmode=require`. CLI only; the app uses internal hosts.
const ssl =
  process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

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
  ssl,
  entities: [
    join(__dirname, `../../modules/*/infrastructure/**/*.orm-entity.${ext}`),
  ],
  migrations: [join(__dirname, `migrations/*.${ext}`)],
  synchronize: false,
});
