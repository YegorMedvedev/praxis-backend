import type { Clock } from '../../../shared/clock';
import {
  deletionBackoffMs,
  type RemoteSessionDeletionQueue,
} from '../domain/remote-session-deletion-queue';
import type { RemoteSessionRemover } from '../domain/remote-session-remover';

const BATCH_SIZE = 50;

export interface ProcessSessionDeletionsResult {
  due: number;
  deleted: number;
  failed: number;
}

/**
 * One pass of the cleanup worker: deletes the remote sessions that are due.
 * Safe to run twice (the remover treats "already gone" as success), and a
 * failure only reschedules that entry with backoff; it never throws, so the
 * session removal that queued it is never affected by the remote side.
 */
export class ProcessSessionDeletions {
  constructor(
    private readonly queue: RemoteSessionDeletionQueue,
    private readonly remover: RemoteSessionRemover,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ProcessSessionDeletionsResult> {
    const due = await this.queue.findDue(this.clock.now(), BATCH_SIZE);
    let deleted = 0;
    let failed = 0;
    for (const entry of due) {
      try {
        await this.remover.remove(entry.openaiSessionId);
        await this.queue.complete(entry.openaiSessionId);
        deleted += 1;
      } catch {
        // The error is deliberately not inspected or logged: provider
        // messages may carry remote ids or content.
        failed += 1;
        const attempts = entry.attempts + 1;
        const next = new Date(
          this.clock.now().getTime() + deletionBackoffMs(attempts),
        );
        await this.queue.reschedule(entry.openaiSessionId, attempts, next);
      }
    }
    return { due: due.length, deleted, failed };
  }
}
