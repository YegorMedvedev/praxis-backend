import { CaseNotFoundError } from '../../../shared/domain-error';
import type { CaseCatalog } from '../domain/case-catalog';
import type { CaseCompletionRepository } from '../domain/case-completion';
import type { Language } from '../domain/language';
import type { CaseView } from './case-view';

/** One visible case in one language, with the caller's completion. */
export class GetCase {
  constructor(
    private readonly catalog: CaseCatalog,
    private readonly completions: CaseCompletionRepository,
  ) {}

  async execute(
    caller: { uid: string },
    caseId: string,
    language: Language,
  ): Promise<CaseView> {
    const found = await this.catalog.findVisibleById(caseId);
    const localized = found?.localize(language);
    if (!localized) throw new CaseNotFoundError('case not found');
    const completion = await this.completions.findByUserAndCase(
      caller.uid,
      localized.id,
    );
    return {
      ...localized,
      completed: completion !== null,
      completedAt: completion?.completedAt ?? null,
    };
  }
}
