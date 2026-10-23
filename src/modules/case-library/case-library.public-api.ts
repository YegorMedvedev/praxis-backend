export { CaseLibraryModule } from './case-library.module';
// Other modules depend on this to record a completion when a session ends.
export { RecordCaseCompletion } from './application/record-case-completion';
export type {
  CaseCompletionRecorder,
  RecordCaseCompletionCommand,
} from './application/record-case-completion';
