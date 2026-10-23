import type { CaseCatalog } from '../domain/case-catalog';
import type { CaseCompletionRepository } from '../domain/case-completion';

export interface CaseProgress {
  completedCount: number;
  totalCount: number;
}

/**
 * The caller's progress over the whole visible catalog. Completions of cases
 * that are hidden or gone are never counted, so completed <= total.
 */
export class GetCaseProgress {
  constructor(
    private readonly catalog: CaseCatalog,
    private readonly completions: CaseCompletionRepository,
  ) {}

  async execute(caller: { uid: string }): Promise<CaseProgress> {
    const [visibleIds, completions] = await Promise.all([
      this.catalog.listVisibleIds(),
      this.completions.findByUser(caller.uid),
    ]);
    const visible = new Set(visibleIds);
    const completed = new Set(
      completions.map((c) => c.caseId).filter((id) => visible.has(id)),
    );
    return { completedCount: completed.size, totalCount: visible.size };
  }
}
