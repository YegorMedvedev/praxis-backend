import type { CaseCompletion } from '../domain/case-completion';

/** The `completed` / `completed_at` pair embedded in case read models. */
export interface CompletionState {
  completed: boolean;
  completedAt: Date | null;
}

/** One user's completions, indexed for embedding into case read models. */
export class CompletionIndex {
  private readonly byCase = new Map<string, Date>();

  constructor(completions: readonly CaseCompletion[]) {
    for (const c of completions) this.byCase.set(c.caseId, c.completedAt);
  }

  stateFor(caseId: string): CompletionState {
    const completedAt = this.byCase.get(caseId) ?? null;
    return { completed: completedAt !== null, completedAt };
  }
}
