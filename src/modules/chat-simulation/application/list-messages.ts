import { SessionNotFoundError } from '../../../shared/domain-error';
import type { Clock } from '../../../shared/clock';
import type { Message } from '../domain/message';
import type { MessageRepository } from '../domain/message-repository';
import type { SessionRepository } from '../domain/session-repository';

export class ListMessages {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly messages: MessageRepository,
    private readonly clock: Clock,
  ) {}

  async execute(userId: string, sessionId: string): Promise<Message[]> {
    const session = await this.sessions.findOwned(sessionId, userId);
    if (!session || session.isExpired(this.clock.now()))
      throw new SessionNotFoundError('session not found');
    return this.messages.listBySession(sessionId);
  }
}
