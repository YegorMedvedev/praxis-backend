import type { Clock } from '../../../shared/clock';
import { CaseNotFoundError } from '../../../shared/domain-error';
import type { IdGenerator } from '../../../shared/id-generator';
import type { CaseAgentDirectory } from '../domain/case-agent-directory';
import type { Language } from '../domain/language';
import type { RemoteSessionDeletionQueue } from '../domain/remote-session-deletion-queue';
import { Session } from '../domain/session';
import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';
import { toSessionView, type SessionView } from './session-view';

export interface CreateSessionCommand {
  userId: string;
  caseId: string;
  language: Language;
}

/**
 * Starts a session and discards every other session of the user for the same
 * case (any status), queueing their remote sessions for deletion in the same
 * commit. A case with no patient agent for the language cannot be practised.
 */
export class CreateSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly agents: CaseAgentDirectory,
    private readonly deletions: RemoteSessionDeletionQueue,
    private readonly unitOfWork: UnitOfWork,
    private readonly canceller: SessionGenerationCanceller,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: CreateSessionCommand): Promise<SessionView> {
    const agentId = await this.agents.findAgentId(
      command.caseId,
      command.language,
    );
    if (agentId === null) throw new CaseNotFoundError('case not found');

    const now = this.clock.now();
    const session = Session.start({
      id: this.ids.next(),
      userId: command.userId,
      caseId: command.caseId,
      language: command.language,
      agentId,
      now,
    });

    const replaced = await this.unitOfWork.run(async () => {
      const removed = await this.sessions.deleteAllForUserCase(
        command.userId,
        command.caseId,
      );
      for (const old of removed) {
        if (old.openaiSessionId !== null) {
          await this.deletions.enqueue(old.openaiSessionId, now);
        }
      }
      await this.sessions.insert(session);
      return removed;
    });

    for (const old of replaced) this.canceller.cancel(old.id);
    return toSessionView({
      session,
      therapistMessageCount: 0,
      patientMessageCount: 0,
    });
  }
}
