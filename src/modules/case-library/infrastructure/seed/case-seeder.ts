import type { EntityManager } from 'typeorm';
import { LANGUAGES } from '../../domain/language';
import {
  CaseOrmEntity,
  CaseTranslationOrmEntity,
} from '../persistence/case.orm-entity';
import type { SeedCase } from './case-seed.data';

/**
 * Upserts the given cases and their translations in one transaction. Safe to
 * re-run: rows are matched by id and language and overwritten with the seed
 * values. It never deletes, so removing a case or a translation stays a
 * deliberate manual act. Never called on boot; run it with `pnpm seed:cases`.
 */
export async function seedCases(
  manager: EntityManager,
  cases: readonly SeedCase[],
): Promise<{ cases: number; translations: number }> {
  let translations = 0;
  await manager.transaction(async (tx) => {
    for (const [position, seed] of cases.entries()) {
      await tx.upsert(
        CaseOrmEntity,
        {
          id: seed.id,
          position,
          level: seed.level,
          category: seed.category,
          avatar: seed.avatar,
          patientAge: seed.patientAge,
        },
        ['id'],
      );
      for (const language of LANGUAGES) {
        const content = seed.content[language];
        if (!content) continue;
        await tx.upsert(
          CaseTranslationOrmEntity,
          {
            caseId: seed.id,
            language,
            title: content.title,
            teaser: content.teaser,
            scenario: content.scenario,
            patientName: content.patientName,
            contentNote: content.contentNote,
          },
          ['caseId', 'language'],
        );
        translations += 1;
      }
    }
  });
  return { cases: cases.length, translations };
}
