import type { Language } from './language';

/**
 * Port: the patient agent for a case and language. Adapted onto case-library
 * in infrastructure. Null when the case is unknown, hidden, or has no agent
 * for the language.
 */
export interface CaseAgentDirectory {
  findAgentId(caseId: string, language: Language): Promise<string | null>;
}
