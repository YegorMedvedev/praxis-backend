import { SessionNotFoundError } from '../../../shared/domain-error';
import type { SessionRepository } from '../domain/session-repository';
import { toSessionView, type SessionView } from './session-view';

export class GetSession {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(userId: string, sessionId: string): Promise<SessionView> {
    const found = await this.sessions.findOwnedWithStats(sessionId, userId);
    if (!found) throw new SessionNotFoundError('session not found');
    return toSessionView(found);
  }
}
