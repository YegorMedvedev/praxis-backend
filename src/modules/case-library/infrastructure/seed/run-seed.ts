import dataSource from '../../../../platform/database/data-source';
import { CASE_SEED } from './case-seed.data';
import { seedCases } from './case-seeder';

/** CLI entry for `pnpm seed:cases`. Never imported by the application. */
async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const result = await seedCases(dataSource.manager, CASE_SEED);
    console.log(
      `Seeded ${result.cases} cases and ${result.translations} translations.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Seeding failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
