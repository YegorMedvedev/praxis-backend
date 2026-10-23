import { isLanguage } from '../../domain/language';
import {
  SESSION_STATUSES,
  Session,
  type SessionStatus,
} from '../../domain/session';
import { SessionOrmEntity } from './session.orm-entity';

export const SessionMapper = {
  toDomain(row: SessionOrmEntity): Session {
    if (!isLanguage(row.language)) {
      throw new Error('stored session has an unsupported language');
    }
    if (!(SESSION_STATUSES as readonly string[]).includes(row.status)) {
      throw new Error('stored session has an unknown status');
    }
    return Session.restore({
      id: row.id,
      userId: row.userId,
      caseId: row.caseId,
      language: row.language,
      status: row.status as SessionStatus,
      createdAt: row.createdAt,
      endedAt: row.endedAt,
      agentId: row.agentId,
      openaiSessionId: row.openaiSessionId,
      remoteInSync: row.remoteInSync,
    });
  },

  toRow(session: Session): SessionOrmEntity {
    const snapshot = session.snapshot();
    const row = new SessionOrmEntity();
    row.id = snapshot.id;
    row.userId = snapshot.userId;
    row.caseId = snapshot.caseId;
    row.language = snapshot.language;
    row.status = snapshot.status;
    row.agentId = snapshot.agentId;
    row.openaiSessionId = snapshot.openaiSessionId;
    row.remoteInSync = snapshot.remoteInSync;
    row.createdAt = snapshot.createdAt;
    row.endedAt = snapshot.endedAt;
    return row;
  },
};
