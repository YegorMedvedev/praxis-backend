import type { Clock } from '../../../shared/clock';
import {
  ReplyPendingError,
  SessionEndedError,
  SessionNotFoundError,
} from '../../../shared/domain-error';
import type { IdGenerator } from '../../../shared/id-generator';
import { normalizeTherapistText, type Message } from '../domain/message';
import {
  isReplyPending,
  type MessageRepository,
} from '../domain/message-repository';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';

/**
 * Stores the therapist's message. The session row is locked so that two
 * concurrent posts, a post and a reply being stored, and a post and the end
 * of the session are serialised: only a transcript whose last message is the
 * patient's accepts another therapist message.
 */
export class SendTherapistMessage {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly messages: MessageRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    sessionId: string,
    rawText: string,
  ): Promise<Message> {
    const text = normalizeTherapistText(rawText);
    return this.unitOfWork.run(async () => {
      const session = await this.sessions.lockOwned(sessionId, userId);
      if (!session || session.isExpired(this.clock.now())) {
        throw new SessionNotFoundError('session not found');
      }
      if (!session.isInProgress()) {
        throw new SessionEndedError('session already ended');
      }
      const last = await this.messages.findLast(sessionId);
      if (isReplyPending(last)) {
        throw new ReplyPendingError('a reply is pending');
      }
      const message: Message = {
        id: this.ids.next(),
        sessionId,
        role: 'THERAPIST',
        text,
        createdAt: this.clock.now(),
      };
      await this.messages.append(message);
      return message;
    });
  }
}
