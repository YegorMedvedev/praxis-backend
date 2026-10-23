/**
 * Port: marks a case completed for a user. Idempotent. Joins the active
 * unit of work, so it is atomic with the session end.
 */
export interface CaseCompletionRecorder {
  record(userId: string, caseId: string): Promise<void>;
}
