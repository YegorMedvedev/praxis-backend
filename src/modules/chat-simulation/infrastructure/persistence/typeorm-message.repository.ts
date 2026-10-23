import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { activeRepository } from '../../../../platform/database/transaction-context';
import { MESSAGE_ROLES, type Message } from '../../domain/message';
import type { MessageRepository } from '../../domain/message-repository';
import { MessageOrmEntity } from './message.orm-entity';

function toDomain(row: MessageOrmEntity): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: MESSAGE_ROLES.find((role) => role === row.role) ?? 'THERAPIST',
    text: row.text,
    createdAt: row.createdAt,
  };
}

/** Every call joins the active transaction (see `runInTransaction`). */
@Injectable()
export class TypeOrmMessageRepository implements MessageRepository {
  constructor(
    @InjectRepository(MessageOrmEntity)
    private readonly rows: Repository<MessageOrmEntity>,
  ) {}

  private get repo(): Repository<MessageOrmEntity> {
    return activeRepository(this.rows);
  }

  async listBySession(sessionId: string): Promise<Message[]> {
    const rows = await this.repo
      .createQueryBuilder('m')
      .where('m.session_id = :sessionId', { sessionId })
      .orderBy('m.seq', 'ASC')
      .getMany();
    return rows.map(toDomain);
  }

  async findLast(sessionId: string): Promise<Message | null> {
    const row = await this.repo
      .createQueryBuilder('m')
      .where('m.session_id = :sessionId', { sessionId })
      .orderBy('m.seq', 'DESC')
      .getOne();
    return row ? toDomain(row) : null;
  }

  async append(message: Message): Promise<void> {
    await this.repo.insert({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    });
  }
}
