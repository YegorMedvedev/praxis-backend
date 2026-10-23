import type { EntityManager } from 'typeorm';
import { LANGUAGES } from '../../domain/language';
import {
  CaseOrmEntity,
  CaseTranslationOrmEntity,
} from '../persistence/case.orm-entity';
import type { SeedCase } from './case-seed.data';

const MAX_AGENT_ID_LENGTH = 128;

/** Throws before any database work; names case and language, never the value. */
export function validateAgentIds(cases: readonly SeedCase[]): void {
  for (const seed of cases) {
    for (const language of LANGUAGES) {
      const agentId = seed.agentIds?.[language];
      if (agentId === undefined) continue;
      if (
        !seed.content[language] ||
        agentId.trim().length === 0 ||
        agentId.length > MAX_AGENT_ID_LENGTH ||
        // eslint-disable-next-line no-control-regex
        /[\s\u0000-\u001f\u007f-\u009f]/u.test(agentId)
      ) {
        throw new Error(
          `invalid agent id for case "${seed.id}" language "${language}"`,
        );
      }
    }
  }
}

/**
 * Upserts the given cases and their translations in one transaction. Safe to
 * re-run: rows are matched by id and language and overwritten with the seed
 * values. It never deletes, so removing a case or a translation stays a
 * deliberate manual act. An agent id is written only when the seed provides it;
 * an omitted id never clears a stored one. Agent ids are validated up front. Never called on boot; run it with `pnpm seed:cases`.
 */
export async function seedCases(
  manager: EntityManager,
  cases: readonly SeedCase[],
): Promise<{ cases: number; translations: number }> {
  validateAgentIds(cases);
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
        const agentId = seed.agentIds?.[language];
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
            ...(agentId === undefined ? {} : { agentId }),
          },
          ['caseId', 'language'],
        );
        translations += 1;
      }
    }
  });
  return { cases: cases.length, translations };
}
