import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CaseCompletion,
  CaseCompletionRepository,
} from '../../domain/case-completion';
import { activeRepository } from '../../../../platform/database/transaction-context';
import { CaseCompletionOrmEntity } from './case-completion.orm-entity';

const toDomain = (row: CaseCompletionOrmEntity): CaseCompletion => ({
  userId: row.userId,
  caseId: row.caseId,
  completedAt: row.completedAt,
});

@Injectable()
export class TypeOrmCaseCompletionRepository implements CaseCompletionRepository {
  constructor(
    @InjectRepository(CaseCompletionOrmEntity)
    private readonly rows: Repository<CaseCompletionOrmEntity>,
  ) {}

  async recordIfAbsent(completion: CaseCompletion): Promise<boolean> {
    const row = new CaseCompletionOrmEntity();
    row.userId = completion.userId;
    row.caseId = completion.caseId;
    row.completedAt = completion.completedAt;
    // Joins the caller's transaction when one is active (a session ending in
    // another module records its completion atomically with the end).
    const result = await activeRepository(this.rows)
      .createQueryBuilder()
      .insert()
      .values(row)
      .orIgnore()
      .returning('user_id')
      .execute();
    // ON CONFLICT DO NOTHING returns no row when the pair already exists.
    return Array.isArray(result.raw) && result.raw.length > 0;
  }

  async findByUser(userId: string): Promise<CaseCompletion[]> {
    const rows = await this.rows.find({
      where: { userId },
      order: { completedAt: 'ASC', caseId: 'ASC' },
    });
    return rows.map(toDomain);
  }

  async findByUserAndCase(
    userId: string,
    caseId: string,
  ): Promise<CaseCompletion | null> {
    const row = await this.rows.findOneBy({ userId, caseId });
    return row ? toDomain(row) : null;
  }
}
