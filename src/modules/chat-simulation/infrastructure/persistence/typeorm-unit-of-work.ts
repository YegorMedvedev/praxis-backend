import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runInTransaction } from '../../../../platform/database/transaction-context';
import type { UnitOfWork } from '../../domain/unit-of-work';

/**
 * One database transaction per unit. Repositories and the adapters of other
 * modules join it through the ambient transaction context, so the session
 * change, the cleanup queue row and the case completion commit together.
 */
@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return runInTransaction(this.dataSource, work);
  }
}
