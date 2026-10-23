import type { Language } from './language';

/**
 * Server-only mapping from (case, language) to the patient agent id. Kept apart
 * from `Case` so the id can never reach a learner-facing projection.
 */
export interface PatientAgentDirectory {
  /**
   * The configured agent id for a VISIBLE case in `language`, or null when the
   * case is unknown, malformed, hidden or has no id. Never throws on odd input.
   */
  findAgentId(caseId: string, language: Language): Promise<string | null>;
}
