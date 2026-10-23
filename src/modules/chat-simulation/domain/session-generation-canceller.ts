/**
 * Port: cancels a patient reply being generated for a session, storing no
 * partial reply. Called after a session ends or is discarded. Safe to call
 * when nothing is running.
 */
export interface SessionGenerationCanceller {
  cancel(sessionId: string): void;
}
