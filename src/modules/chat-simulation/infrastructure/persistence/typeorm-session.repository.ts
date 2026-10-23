import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { activeRepository } from '../../../../platform/database/transaction-context';
import type { Session, SessionWithStats } from '../../domain/session';
import type {
  RemovedSession,
  SessionRepository,
} from '../../domain/session-repository';
import { SessionMapper } from './session.mapper';
import { SessionOrmEntity } from './session.orm-entity';

/** Longest id the columns can hold; anything longer cannot exist. */
const MAX_ID_LENGTH = 128;

/** PostgreSQL text cannot hold NUL, and the column is bounded. */
const isStorableId = (id: string): boolean =>
  id.length > 0 && id.length <= MAX_ID_LENGTH && !id.includes('\u0000');

interface DeletedRow {
  id: string;
  openai_session_id: string | null;
}

/** Every call joins the active transaction (see `runInTransaction`). */
@Injectable()
export class TypeOrmSessionRepository implements SessionRepository {
  constructor(
    @InjectRepository(SessionOrmEntity)
    private readonly rows: Repository<SessionOrmEntity>,
  ) {}

  private get repo(): Repository<SessionOrmEntity> {
    return activeRepository(this.rows);
  }

  async insert(session: Session): Promise<void> {
    await this.repo.insert(SessionMapper.toRow(session));
  }

  async findOwnedWithStats(
    id: string,
    userId: string,
  ): Promise<SessionWithStats | null> {
    if (!isStorableId(id) || !isStorableId(userId)) return null;
    const row = await this.repo.findOneBy({ id, userId });
    if (!row) return null;
    const counts: { role: string; count: string }[] = await this.repo.manager
      .createQueryBuilder()
      .select('m.role', 'role')
      .addSelect('count(*)', 'count')
      .from('chat_simulation.messages', 'm')
      .where('m.session_id = :id', { id })
      .groupBy('m.role')
      .getRawMany();
    const countOf = (role: string): number =>
      Number(counts.find((c) => c.role === role)?.count ?? 0);
    return {
      session: SessionMapper.toDomain(row),
      therapistMessageCount: countOf('THERAPIST'),
      patientMessageCount: countOf('PATIENT'),
    };
  }

  async findOwned(id: string, userId: string): Promise<Session | null> {
    if (!isStorableId(id) || !isStorableId(userId)) return null;
    const row = await this.repo.findOneBy({ id, userId });
    return row ? SessionMapper.toDomain(row) : null;
  }

  async lockOwned(id: string, userId: string): Promise<Session | null> {
    if (!isStorableId(id) || !isStorableId(userId)) return null;
    const row = await this.repo
      .createQueryBuilder('s')
      .where('s.id = :id AND s.userId = :userId', { id, userId })
      .setLock('pessimistic_write')
      .getOne();
    return row ? SessionMapper.toDomain(row) : null;
  }

  async save(session: Session): Promise<void> {
    const snapshot = session.snapshot();
    await this.repo.update(
      { id: snapshot.id },
      {
        status: snapshot.status,
        endedAt: snapshot.endedAt,
        openaiSessionId: snapshot.openaiSessionId,
        remoteInSync: snapshot.remoteInSync,
      },
    );
  }

  async deleteOwned(
    id: string,
    userId: string,
  ): Promise<RemovedSession | null> {
    if (!isStorableId(id) || !isStorableId(userId)) return null;
    const rows = await this.deleteWhere('id = $1 AND user_id = $2', [
      id,
      userId,
    ]);
    return rows[0] ?? null;
  }

  async deleteAllForUserCase(
    userId: string,
    caseId: string,
  ): Promise<RemovedSession[]> {
    // Serialise concurrent creates for the same user and case; the unique
    // index is the backstop.
    await this.repo.manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [JSON.stringify([userId, caseId])],
    );
    return this.deleteWhere('user_id = $1 AND case_id = $2', [userId, caseId]);
  }

  async deleteExpired(cutoff: Date, limit: number): Promise<RemovedSession[]> {
    // SKIP LOCKED: a session being written right now is left for the next
    // pass instead of blocking this one. Messages cascade with the row.
    return this.deleteWhere(
      `id IN (
         SELECT id FROM chat_simulation.sessions
         WHERE created_at <= $1
         ORDER BY created_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )`,
      [cutoff, limit],
    );
  }

  private async deleteWhere(
    where: string,
    params: unknown[],
  ): Promise<RemovedSession[]> {
    // The transcript goes with the row (messages cascade).
    const result: unknown = await this.repo.manager.query(
      `DELETE FROM chat_simulation.sessions WHERE ${where}
       RETURNING id, openai_session_id`,
      params,
    );
    // The driver answers [rows, affectedCount] for DELETE ... RETURNING.
    const rows = (
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
    ) as DeletedRow[];
    return rows.map((r) => ({
      id: r.id,
      openaiSessionId: r.openai_session_id,
    }));
  }
}
