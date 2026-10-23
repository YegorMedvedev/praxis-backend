export interface PendingRemoteDeletion {
  openaiSessionId: string;
  attempts: number;
}

/**
 * Durable queue of remote sessions to delete (`agent_session_deletions`).
 * Enqueueing joins the active unit of work, so a session is never removed
 * without its remote counterpart being queued in the same commit.
 */
export interface RemoteSessionDeletionQueue {
  /** Idempotent: queueing the same remote session twice keeps one entry. */
  enqueue(openaiSessionId: string, now: Date): Promise<void>;
  findDue(now: Date, limit: number): Promise<PendingRemoteDeletion[]>;
  complete(openaiSessionId: string): Promise<void>;
  reschedule(
    openaiSessionId: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void>;
}

const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Exponential backoff: 30 s after the first failure, doubling, capped at 1 h. */
export function deletionBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(exponent, 20));
}
