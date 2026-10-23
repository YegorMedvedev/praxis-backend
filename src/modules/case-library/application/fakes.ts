import { Case, type CaseContent, type CaseProps } from '../domain/case';
import type { CaseCatalog } from '../domain/case-catalog';
import type {
  CaseCompletion,
  CaseCompletionRepository,
} from '../domain/case-completion';

/** In-memory fakes for use case tests. */
export class InMemoryCaseCatalog implements CaseCatalog {
  constructor(private cases: Case[] = []) {}

  set(cases: Case[]): void {
    this.cases = cases;
  }

  listVisible(): Promise<Case[]> {
    return Promise.resolve(this.cases.filter((c) => c.isVisible()));
  }

  listVisibleIds(): Promise<string[]> {
    return Promise.resolve(
      this.cases.filter((c) => c.isVisible()).map((c) => c.id),
    );
  }

  findVisibleById(id: string): Promise<Case | null> {
    return Promise.resolve(
      this.cases.find((c) => c.id === id && c.isVisible()) ?? null,
    );
  }
}

export class InMemoryCaseCompletionRepository implements CaseCompletionRepository {
  readonly completions = new Map<string, CaseCompletion>();

  private static key(userId: string, caseId: string): string {
    return JSON.stringify([userId, caseId]);
  }

  recordIfAbsent(completion: CaseCompletion): Promise<boolean> {
    const key = InMemoryCaseCompletionRepository.key(
      completion.userId,
      completion.caseId,
    );
    if (this.completions.has(key)) return Promise.resolve(false);
    this.completions.set(key, completion);
    return Promise.resolve(true);
  }

  findByUser(userId: string): Promise<CaseCompletion[]> {
    return Promise.resolve(
      [...this.completions.values()].filter((c) => c.userId === userId),
    );
  }

  findByUserAndCase(
    userId: string,
    caseId: string,
  ): Promise<CaseCompletion | null> {
    return Promise.resolve(
      this.completions.get(
        InMemoryCaseCompletionRepository.key(userId, caseId),
      ) ?? null,
    );
  }
}

const fakeContent: CaseContent = {
  title: 'Placeholder case',
  teaser: 'Placeholder teaser',
  scenario: 'Placeholder scenario',
  patientName: 'Placeholder Patient',
  contentNote: null,
};

/** A visible case unless `content` says otherwise. */
export function makeCase(id: string, overrides: Partial<CaseProps> = {}): Case {
  return Case.restore({
    id,
    level: 'EASY',
    category: 'SUBSTANCE_USE',
    avatar: 'HAIR_UP',
    patientAge: 40,
    content: { en: fakeContent, ru: fakeContent },
    ...overrides,
  });
}
