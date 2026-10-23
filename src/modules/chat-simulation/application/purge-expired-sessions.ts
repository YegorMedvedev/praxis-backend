import type { Clock } from '../../../shared/clock';
import type { RemoteSessionDeletionQueue } from '../domain/remote-session-deletion-queue';
import { retentionCutoff } from '../domain/retention';
import type { SessionGenerationCanceller } from '../domain/session-generation-canceller';
import type { SessionRepository } from '../domain/session-repository';
import type { UnitOfWork } from '../domain/unit-of-work';

export const PURGE_BATCH_SIZE = 200;
/** Upper bound per pass (200 x 500 = 100,000 sessions); the rest waits for the next pass. */
export const PURGE_MAX_BATCHES = 500;

export interface PurgeExpiredSessionsResult {
  sessions: number;
  remoteSessionsQueued: number;
  batches: number;
}

/**
 * Retention (05 FR-6, FR-18): deletes every session created 90 days ago or
 * earlier, with its messages, and queues each session's `openai_session_id`
 * for remote deletion IN THE SAME TRANSACTION as the deletion (one
 * transaction per batch). Case completion is not touched. Idempotent: a
 * second run finds nothing. A failing batch rolls back whole (nothing is
 * deleted without its queue entry) and the error propagates to the worker.
 */
export class PurgeExpiredSessions {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly deletions: RemoteSessionDeletionQueue,
    private readonly unitOfWork: UnitOfWork,
    private readonly canceller: SessionGenerationCanceller,
    private readonly clock: Clock,
    private readonly batchSize: number = PURGE_BATCH_SIZE,
    private readonly maxBatches: number = PURGE_MAX_BATCHES,
  ) {}

  async execute(): Promise<PurgeExpiredSessionsResult> {
    const result: PurgeExpiredSessionsResult = {
      sessions: 0,
      remoteSessionsQueued: 0,
      batches: 0,
    };
    while (result.batches < this.maxBatches) {
      const now = this.clock.now();
      const removed = await this.unitOfWork.run(async () => {
        const removed = await this.sessions.deleteExpired(
          retentionCutoff(now),
          this.batchSize,
        );
        for (const session of removed) {
          if (session.openaiSessionId) {
            await this.deletions.enqueue(session.openaiSessionId, now);
          }
        }
        return removed;
      });
      if (removed.length === 0) break;
      result.batches += 1;
      result.sessions += removed.length;
      result.remoteSessionsQueued += removed.filter(
        (s) => s.openaiSessionId,
      ).length;
      // A reply still being generated for a purged session must not be stored.
      removed.forEach((s) => this.canceller.cancel(s.id));
      if (removed.length < this.batchSize) break;
    }
    return result;
  }
}
