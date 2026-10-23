import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { CaseCompletionOrmEntity } from '../../src/modules/case-library/infrastructure/persistence/case-completion.orm-entity';
import {
  CaseOrmEntity,
  CaseTranslationOrmEntity,
} from '../../src/modules/case-library/infrastructure/persistence/case.orm-entity';
import { TypeOrmCaseCatalog } from '../../src/modules/case-library/infrastructure/persistence/typeorm-case-catalog';
import { TypeOrmCaseCompletionRepository } from '../../src/modules/case-library/infrastructure/persistence/typeorm-case-completion.repository';
import {
  CASE_SEED,
  type SeedCase,
} from '../../src/modules/case-library/infrastructure/seed/case-seed.data';
import { seedCases } from '../../src/modules/case-library/infrastructure/seed/case-seeder';
import { CreateCaseLibrary1760000001000 } from '../../src/platform/database/migrations/1760000001000-CreateCaseLibrary';

const content = (title: string, contentNote: string | null = null) => ({
  title,
  teaser: `${title} teaser`,
  scenario: `${title} scenario`,
  patientName: 'Placeholder Patient',
  contentNote,
});

const fixture = (id: string, languages: ('en' | 'ru')[]): SeedCase => ({
  id,
  level: 'EASY',
  category: 'SUBSTANCE_USE',
  avatar: 'HAIR_UP',
  patientAge: 30,
  content: Object.fromEntries(
    languages.map((l) => [l, content(`T-${id}-${l}`)]),
  ),
});

describe('Case library repositories and migration (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let catalog: TypeOrmCaseCatalog;
  let completions: TypeOrmCaseCompletionRepository;

  const count = async (sql: string): Promise<number> => {
    const [{ count }] = await dataSource.query(sql);
    return count;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    dataSource = await new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [
        CaseOrmEntity,
        CaseTranslationOrmEntity,
        CaseCompletionOrmEntity,
      ],
      migrations: [CreateCaseLibrary1760000001000],
      synchronize: false,
    }).initialize();
    await dataSource.runMigrations();
    catalog = new TypeOrmCaseCatalog(dataSource.getRepository(CaseOrmEntity));
    completions = new TypeOrmCaseCompletionRepository(
      dataSource.getRepository(CaseCompletionOrmEntity),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await container?.stop();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE case_library.case_completions, case_library.case_translations, case_library.cases CASCADE',
    );
  });

  it('creates the schema with no foreign key to another schema or to completions', async () => {
    const fks = await dataSource.query(
      `SELECT tc.table_name, ccu.table_name AS target
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu USING (constraint_name, constraint_schema)
       WHERE tc.table_schema = 'case_library' AND tc.constraint_type = 'FOREIGN KEY'`,
    );
    expect(fks).toEqual([{ table_name: 'case_translations', target: 'cases' }]);
  });

  describe('catalog visibility', () => {
    it('lists only cases with content in both languages, in curated order', async () => {
      await seedCases(dataSource.manager, [
        fixture('b', ['en', 'ru']),
        fixture('only-en', ['en']),
        fixture('only-ru', ['ru']),
        fixture('a', ['en', 'ru']),
        fixture('none', []),
      ]);

      const listed = await catalog.listVisible();
      expect(listed.map((c) => c.id)).toEqual(['b', 'a']);
      await expect(catalog.listVisibleIds()).resolves.toEqual(['b', 'a']);
      expect(listed[0].localize('ru')?.title).toBe('T-b-ru');
      expect(listed[0].localize('en')?.title).toBe('T-b-en');
    });

    it('finds a visible case and nothing for hidden, unknown or odd ids', async () => {
      await seedCases(dataSource.manager, [
        fixture('ok', ['en', 'ru']),
        fixture('hidden', ['en']),
      ]);

      expect((await catalog.findVisibleById('ok'))?.id).toBe('ok');
      await expect(catalog.findVisibleById('hidden')).resolves.toBeNull();
      await expect(catalog.findVisibleById('missing')).resolves.toBeNull();
      for (const odd of [
        '',
        ' ',
        "x'; DROP TABLE a;--",
        '../../etc',
        '\u0000',
        '%',
        'é'.repeat(50),
        'x'.repeat(5000),
      ]) {
        await expect(catalog.findVisibleById(odd)).resolves.toBeNull();
      }
    });

    it('round-trips a null content note', async () => {
      await seedCases(dataSource.manager, [
        {
          ...fixture('n', ['en', 'ru']),
          content: { en: content('E'), ru: content('R', 'Заметка') },
        },
      ]);
      const found = await catalog.findVisibleById('n');
      expect(found?.localize('en')?.contentNote).toBeNull();
      expect(found?.localize('ru')?.contentNote).toBe('Заметка');
    });

    it('rejects blank text in the database', async () => {
      await seedCases(dataSource.manager, [fixture('c', ['en'])]);
      await expect(
        dataSource.query(
          `UPDATE case_library.case_translations SET title = '  ' WHERE case_id = 'c'`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('completions', () => {
    const at = (iso: string) => new Date(iso);

    it('records once and keeps the first completed_at', async () => {
      await expect(
        completions.recordIfAbsent({
          userId: 'u1',
          caseId: 'c1',
          completedAt: at('2026-01-01T10:00:00.123Z'),
        }),
      ).resolves.toBe(true);
      await expect(
        completions.recordIfAbsent({
          userId: 'u1',
          caseId: 'c1',
          completedAt: at('2026-02-01T10:00:00Z'),
        }),
      ).resolves.toBe(false);

      const stored = await completions.findByUserAndCase('u1', 'c1');
      expect(stored?.completedAt).toEqual(at('2026-01-01T10:00:00.123Z'));
    });

    it('lets exactly one of many concurrent completions win', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          completions.recordIfAbsent({
            userId: 'u1',
            caseId: 'race',
            completedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, i)),
          }),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await count(
          `SELECT count(*)::int AS count FROM case_library.case_completions WHERE case_id = 'race'`,
        ),
      ).toBe(1);
      const winner = await completions.findByUserAndCase('u1', 'race');
      const winnerIndex = results.findIndex(Boolean);
      expect(winner?.completedAt).toEqual(
        new Date(Date.UTC(2026, 0, 1, 10, 0, winnerIndex)),
      );
    });

    it('reads per user only', async () => {
      const when = at('2026-01-01T00:00:00Z');
      await completions.recordIfAbsent({
        userId: 'u1',
        caseId: 'c1',
        completedAt: when,
      });
      await completions.recordIfAbsent({
        userId: 'u2',
        caseId: 'c1',
        completedAt: when,
      });
      await completions.recordIfAbsent({
        userId: 'u2',
        caseId: 'c2',
        completedAt: when,
      });

      expect((await completions.findByUser('u1')).map((c) => c.caseId)).toEqual(
        ['c1'],
      );
      expect(await completions.findByUser('u2')).toHaveLength(2);
      await expect(completions.findByUser('nobody')).resolves.toEqual([]);
      await expect(
        completions.findByUserAndCase('u1', 'c2'),
      ).resolves.toBeNull();
    });

    it('keeps a completion after its case is removed', async () => {
      await seedCases(dataSource.manager, [fixture('c1', ['en', 'ru'])]);
      await completions.recordIfAbsent({
        userId: 'u1',
        caseId: 'c1',
        completedAt: at('2026-01-01T00:00:00Z'),
      });

      await dataSource.query(`DELETE FROM case_library.cases WHERE id = 'c1'`);

      expect(await completions.findByUser('u1')).toHaveLength(1);
      await expect(catalog.listVisibleIds()).resolves.toEqual([]);
    });
  });

  describe('seed', () => {
    it('loads the placeholder catalog and is idempotent', async () => {
      await seedCases(dataSource.manager, CASE_SEED);
      const snapshot = async () =>
        dataSource.query(
          `SELECT c.id, c.position, t.language, t.title, t.content_note
           FROM case_library.cases c JOIN case_library.case_translations t ON t.case_id = c.id
           ORDER BY c.position, t.language`,
        );
      const first = await snapshot();

      await seedCases(dataSource.manager, CASE_SEED);

      expect(await snapshot()).toEqual(first);
      expect(
        await count('SELECT count(*)::int AS count FROM case_library.cases'),
      ).toBe(CASE_SEED.length);
      expect(
        await count(
          'SELECT count(*)::int AS count FROM case_library.case_translations',
        ),
      ).toBe(CASE_SEED.length * 2);
      expect((await catalog.listVisible()).map((c) => c.id)).toEqual(
        CASE_SEED.map((c) => c.id),
      );
      await expect(catalog.listVisibleIds()).resolves.toEqual(
        CASE_SEED.map((c) => c.id),
      );
    });

    it('overwrites changed content without duplicating', async () => {
      await seedCases(dataSource.manager, [fixture('x', ['en', 'ru'])]);
      await seedCases(dataSource.manager, [
        {
          ...fixture('x', ['en', 'ru']),
          content: { en: content('New'), ru: content('Новый') },
        },
      ]);
      expect((await catalog.findVisibleById('x'))?.localize('en')?.title).toBe(
        'New',
      );
      expect(
        await count('SELECT count(*)::int AS count FROM case_library.cases'),
      ).toBe(1);
    });
  });

  it('can be reverted', async () => {
    await dataSource.undoLastMigration();
    const tables = await dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'case_library'`,
    );
    expect(tables).toEqual([]);
    await dataSource.runMigrations();
  });
});
