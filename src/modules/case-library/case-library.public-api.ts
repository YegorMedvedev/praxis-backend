export { CaseLibraryModule } from './case-library.module';
// Other modules depend on this to record a completion when a session ends.
export { RecordCaseCompletion } from './application/record-case-completion';
export type {
  CaseCompletionRecorder,
  RecordCaseCompletionCommand,
} from './application/record-case-completion';
// Server-only lookup of the patient agent for a case; never exposed over HTTP.
export { ResolvePatientAgent } from './application/resolve-patient-agent';
export type {
  PatientAgentResolution,
  PatientAgentResolver,
  ResolvePatientAgentQuery,
} from './application/resolve-patient-agent';
export type { Language } from './domain/language';
