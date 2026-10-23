import { Injectable } from '@nestjs/common';
import {
  RecordCaseCompletion,
  ResolvePatientAgent,
} from '../../case-library/case-library.public-api';
import type { CaseAgentDirectory } from '../domain/case-agent-directory';
import type { CaseCompletionRecorder } from '../domain/case-completion-recorder';
import type { Language } from '../domain/language';

/** Adapts case-library's public `ResolvePatientAgent` onto our own port. */
@Injectable()
export class CaseLibraryAgentDirectory implements CaseAgentDirectory {
  constructor(private readonly resolve: ResolvePatientAgent) {}

  async findAgentId(
    caseId: string,
    language: Language,
  ): Promise<string | null> {
    const resolution = await this.resolve.execute({ caseId, language });
    return resolution?.agentId ?? null;
  }
}

/**
 * Adapts case-library's public `RecordCaseCompletion`. It runs inside the
 * session's unit of work: case-library's repository joins the ambient
 * transaction, so the completion is atomic with the session end.
 */
@Injectable()
export class CaseLibraryCompletionRecorder implements CaseCompletionRecorder {
  constructor(private readonly recordCompletion: RecordCaseCompletion) {}

  async record(userId: string, caseId: string): Promise<void> {
    await this.recordCompletion.execute({ userId, caseId });
  }
}
