import { ValidationFailedError } from '../../../shared/domain-error';
import type { Clock } from '../../../shared/clock';
import type { CaseCompletionRepository } from '../domain/case-completion';

export interface RecordCaseCompletionCommand {
  /** Firebase uid of the learner whose session ended. */
  userId: string;
  caseId: string;
}

/** What other modules (chat-simulation) depend on to record a completion. */
export interface CaseCompletionRecorder {
  execute(command: RecordCaseCompletionCommand): Promise<{ recorded: boolean }>;
}

/**
 * Marks a case completed for a user. Idempotent and concurrency-safe: the
 * first `completedAt` is kept and later calls change nothing. The case is
 * deliberately not checked against the catalog: completion survives a case
 * being hidden or removed, and reads never count what is not visible.
 */
export class RecordCaseCompletion implements CaseCompletionRecorder {
  constructor(
    private readonly completions: CaseCompletionRepository,
    private readonly clock: Clock,
  ) {}

  /** `recorded` is true only for the call that created the completion. */
  async execute(
    command: RecordCaseCompletionCommand,
  ): Promise<{ recorded: boolean }> {
    if (!command.userId.trim() || !command.caseId.trim()) {
      throw new ValidationFailedError('userId and caseId are required');
    }
    const recorded = await this.completions.recordIfAbsent({
      userId: command.userId,
      caseId: command.caseId,
      completedAt: this.clock.now(),
    });
    return { recorded };
  }
}
