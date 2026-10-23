import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LANGUAGES, type Language } from '../../domain/language';
import type { PatientAgentDirectory } from '../../domain/patient-agent-directory';
import { CaseTranslationOrmEntity } from './case.orm-entity';

/** Longest id the schema can hold; anything longer cannot exist. */
const MAX_ID_LENGTH = 128;

@Injectable()
export class TypeOrmPatientAgentDirectory implements PatientAgentDirectory {
  constructor(
    @InjectRepository(CaseTranslationOrmEntity)
    private readonly rows: Repository<CaseTranslationOrmEntity>,
  ) {}

  async findAgentId(
    caseId: string,
    language: Language,
  ): Promise<string | null> {
    // PostgreSQL text cannot hold NUL; such an id cannot exist.
    if (
      caseId.length === 0 ||
      caseId.length > MAX_ID_LENGTH ||
      caseId.includes('\u0000')
    ) {
      return null;
    }
    // One read by primary key (case_id, language); the case is visible only
    // when it has a translation in every supported language (same rule as
    // `Case.isVisible`).
    const result: { agent_id: string | null }[] = await this.rows
      .createQueryBuilder('t')
      .select('t.agent_id', 'agent_id')
      .where('t.case_id = :caseId AND t.language = :language', {
        caseId,
        language,
      })
      .andWhere(
        `(SELECT count(DISTINCT v.language) FROM case_library.case_translations v
          WHERE v.case_id = t.case_id AND v.language IN (:...languages)) = :required`,
        { languages: [...LANGUAGES], required: LANGUAGES.length },
      )
      .getRawMany();
    return result[0]?.agent_id ?? null;
  }
}
