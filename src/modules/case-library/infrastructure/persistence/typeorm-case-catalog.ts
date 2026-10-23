import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Case } from '../../domain/case';
import type { CaseCatalog } from '../../domain/case-catalog';
import { LANGUAGES } from '../../domain/language';
import { CaseMapper } from './case.mapper';
import { CaseOrmEntity } from './case.orm-entity';

/** Longest id the schema can hold; anything longer cannot exist. */
const MAX_ID_LENGTH = 128;

@Injectable()
export class TypeOrmCaseCatalog implements CaseCatalog {
  constructor(
    @InjectRepository(CaseOrmEntity)
    private readonly rows: Repository<CaseOrmEntity>,
  ) {}

  async listVisible(): Promise<Case[]> {
    const rows = await this.rows.find({
      relations: { translations: true },
      order: { position: 'ASC', id: 'ASC' },
    });
    // Visibility is the domain rule (`Case.isVisible`), applied after mapping.
    return rows.map(CaseMapper.toDomain).filter((c) => c.isVisible());
  }

  async listVisibleIds(): Promise<string[]> {
    // Must stay in step with `Case.isVisible`: content in every language.
    const rows: { id: string }[] = await this.rows
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .where(
        `(SELECT count(DISTINCT t.language) FROM case_library.case_translations t
          WHERE t.case_id = c.id AND t.language IN (:...languages)) = :required`,
        { languages: [...LANGUAGES], required: LANGUAGES.length },
      )
      .orderBy('c.position', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getRawMany();
    return rows.map((r) => r.id);
  }

  async findVisibleById(id: string): Promise<Case | null> {
    // PostgreSQL text cannot hold NUL; such an id cannot exist.
    if (id.length === 0 || id.length > MAX_ID_LENGTH || id.includes('\u0000')) {
      return null;
    }
    // `id` is a text column compared as a bound parameter: odd input cannot throw.
    const row = await this.rows.findOne({
      where: { id },
      relations: { translations: true },
    });
    const found = row ? CaseMapper.toDomain(row) : null;
    return found?.isVisible() ? found : null;
  }
}
