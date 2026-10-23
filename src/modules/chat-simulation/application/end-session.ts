import type { Clock } from '../../../shared/clock';
import { SessionNotFoundError } from '../../../shared/domain-error';
import type { CaseCompletionRecorder } from '../domain/case-completion-recorder';
import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';
import { toSessionView, type SessionView } from './session-view';

/**
 * Ends a session as the therapist. The state change and the case completion
 * commit together (no ended session whose case is not completed), and the
 * response is read inside that same commit so it matches later GETs.
 */
export class EndSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly completions: CaseCompletionRecorder,
    private readonly unitOfWork: UnitOfWork,
    private readonly canceller: SessionGenerationCanceller,
    private readonly clock: Clock,
  ) {}

  async execute(userId: string, sessionId: string): Promise<SessionView> {
    const { view, transitioned } = await this.unitOfWork.run(async () => {
      const session = await this.sessions.lockOwned(sessionId, userId);
      if (!session || session.isExpired(this.clock.now())) {
        throw new SessionNotFoundError('session not found');
      }

      const transitioned = session.endByTherapist(this.clock.now());
      if (transitioned) {
        await this.sessions.save(session);
        await this.completions.record(session.userId, session.caseId);
      }
      const found = await this.sessions.findOwnedWithStats(sessionId, userId);
      if (!found) throw new SessionNotFoundError('session not found');
      return { view: toSessionView(found), transitioned };
    });

    // A reply in flight is cancelled and nothing of it is stored (02).
    if (transitioned) this.canceller.cancel(sessionId);
    return view;
  }
}
