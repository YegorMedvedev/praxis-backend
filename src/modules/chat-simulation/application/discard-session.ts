import type { Clock } from '../../../shared/clock';
import type { RemoteSessionDeletionQueue } from '../domain/remote-session-deletion-queue';
import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';

/**
 * Discards a session and its transcript. Idempotent: a missing or foreign id
 * is silently fine. Never touches case completion. The remote session is
 * queued for deletion in the same commit and removed later by the worker.
 */
export class DiscardSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly deletions: RemoteSessionDeletionQueue,
    private readonly unitOfWork: UnitOfWork,
    private readonly canceller: SessionGenerationCanceller,
    private readonly clock: Clock,
  ) {}

  async execute(userId: string, sessionId: string): Promise<void> {
    const removed = await this.unitOfWork.run(async () => {
      const removed = await this.sessions.deleteOwned(sessionId, userId);
      if (removed?.openaiSessionId) {
        await this.deletions.enqueue(removed.openaiSessionId, this.clock.now());
      }
      return removed;
    });
    if (removed) this.canceller.cancel(removed.id);
  }
}
