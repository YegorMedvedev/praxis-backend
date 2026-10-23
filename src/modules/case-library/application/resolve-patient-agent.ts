import type { Language } from '../domain/language';
import type { PatientAgentDirectory } from '../domain/patient-agent-directory';

export interface ResolvePatientAgentQuery {
  caseId: string;
  language: Language;
}

export interface PatientAgentResolution {
  agentId: string;
}

/** Contract other modules depend on to find the patient agent of a case. */
export interface PatientAgentResolver {
  execute(
    query: ResolvePatientAgentQuery,
  ): Promise<PatientAgentResolution | null>;
}

/** Null when the case is unknown, hidden, or has no agent for the language. */
export class ResolvePatientAgent implements PatientAgentResolver {
  constructor(private readonly directory: PatientAgentDirectory) {}

  async execute(
    query: ResolvePatientAgentQuery,
  ): Promise<PatientAgentResolution | null> {
    const agentId = await this.directory.findAgentId(
      query.caseId,
      query.language,
    );
    return agentId === null ? null : { agentId };
  }
}
