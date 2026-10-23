import type { CaseCatalog } from '../domain/case-catalog';
import type { CaseCompletionRepository } from '../domain/case-completion';
import type { Language } from '../domain/language';
import type { CaseView } from './case-view';
import { CompletionIndex } from './completion-index';

/** The visible catalog in curated order, in one language, with the caller's completion. */
export class ListCases {
  constructor(
    private readonly catalog: CaseCatalog,
    private readonly completions: CaseCompletionRepository,
  ) {}

  async execute(
    caller: { uid: string },
    language: Language,
  ): Promise<CaseView[]> {
    const [cases, completions] = await Promise.all([
      this.catalog.listVisible(),
      this.completions.findByUser(caller.uid),
    ]);
    const index = new CompletionIndex(completions);
    return cases.flatMap((c) => {
      const localized = c.localize(language);
      return localized ? [{ ...localized, ...index.stateFor(c.id) }] : [];
    });
  }
}
