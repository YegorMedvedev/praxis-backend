import {
  Case,
  type CaseAvatar,
  type CaseCategory,
  type CaseContent,
  type CaseLevel,
} from '../../domain/case';
import { LANGUAGES, type Language } from '../../domain/language';
import { CaseOrmEntity } from './case.orm-entity';

export const CaseMapper = {
  toDomain(row: CaseOrmEntity): Case {
    const content: Partial<Record<Language, CaseContent>> = {};
    for (const t of row.translations ?? []) {
      const language = LANGUAGES.find((l) => l === t.language);
      if (!language) continue;
      content[language] = {
        title: t.title,
        teaser: t.teaser,
        scenario: t.scenario,
        patientName: t.patientName,
        contentNote: t.contentNote,
      };
    }
    return Case.restore({
      id: row.id,
      level: row.level as CaseLevel,
      category: row.category as CaseCategory,
      avatar: row.avatar as CaseAvatar,
      patientAge: row.patientAge,
      content,
    });
  },
};
