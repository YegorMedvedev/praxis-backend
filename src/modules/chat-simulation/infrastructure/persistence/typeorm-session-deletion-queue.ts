import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { activeRepository } from '../../../../platform/database/transaction-context';
import type {
  PendingRemoteDeletion,
  RemoteSessionDeletionQueue,
} from '../../domain/remote-session-deletion-queue';
import { AgentSessionDeletionOrmEntity } from './agent-session-deletion.orm-entity';

@Injectable()
export class TypeOrmSessionDeletionQueue implements RemoteSessionDeletionQueue {
  constructor(
    @InjectRepository(AgentSessionDeletionOrmEntity)
    private readonly rows: Repository<AgentSessionDeletionOrmEntity>,
  ) {}

  private get repo(): Repository<AgentSessionDeletionOrmEntity> {
    return activeRepository(this.rows);
  }

  async enqueue(openaiSessionId: string, now: Date): Promise<void> {
    const row = new AgentSessionDeletionOrmEntity();
    row.openaiSessionId = openaiSessionId;
    row.attempts = 0;
    row.nextAttemptAt = now;
    row.createdAt = now;
    await this.repo
      .createQueryBuilder()
      .insert()
      .values(row)
      .orIgnore()
      .execute();
  }

  async findDue(now: Date, limit: number): Promise<PendingRemoteDeletion[]> {
    const rows = await this.repo
      .createQueryBuilder('d')
      .where('d.nextAttemptAt <= :now', { now })
      .orderBy('d.nextAttemptAt', 'ASC')
      .limit(limit)
      .getMany();
    return rows.map((r) => ({
      openaiSessionId: r.openaiSessionId,
      attempts: r.attempts,
    }));
  }

  async complete(openaiSessionId: string): Promise<void> {
    await this.repo.delete({ openaiSessionId });
  }

  async reschedule(
    openaiSessionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.repo.update({ openaiSessionId }, { attempts, nextAttemptAt });
  }
}
