/** A user has finished a session for a case. Written once, never changed. */
export interface CaseCompletion {
  userId: string;
  caseId: string;
  completedAt: Date;
}

export interface CaseCompletionRepository {
  /**
   * Atomically records the completion. Resolves false, writing nothing, when
   * the user already completed the case, so the first `completedAt` wins even
   * under concurrent calls.
   */
  recordIfAbsent(completion: CaseCompletion): Promise<boolean>;
  /** All of the user's completions, including cases no longer visible. */
  findByUser(userId: string): Promise<CaseCompletion[]>;
  findByUserAndCase(
    userId: string,
    caseId: string,
  ): Promise<CaseCompletion | null>;
}
