import {
  InMemoryCaseCatalog,
  InMemoryCaseCompletionRepository,
  makeCase,
} from './fakes';
import { GetCaseProgress } from './get-case-progress';

describe('GetCaseProgress', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  let catalog: InMemoryCaseCatalog;
  let completions: InMemoryCaseCompletionRepository;
  let progress: GetCaseProgress;

  beforeEach(() => {
    catalog = new InMemoryCaseCatalog([
      makeCase('c1'),
      makeCase('c2'),
      makeCase('c3'),
    ]);
    completions = new InMemoryCaseCompletionRepository();
    progress = new GetCaseProgress(catalog, completions);
  });

  const complete = (userId: string, caseId: string) =>
    completions.recordIfAbsent({ userId, caseId, completedAt: at });

  it('gives a new user 0 of the catalog size', async () => {
    await expect(progress.execute({ uid: 'u1' })).resolves.toEqual({
      completedCount: 0,
      totalCount: 3,
    });
  });

  it('counts the caller completions only', async () => {
    await complete('u1', 'c1');
    await complete('u1', 'c2');
    await complete('u2', 'c3');

    await expect(progress.execute({ uid: 'u1' })).resolves.toEqual({
      completedCount: 2,
      totalCount: 3,
    });
    await expect(progress.execute({ uid: 'u2' })).resolves.toEqual({
      completedCount: 1,
      totalCount: 3,
    });
  });

  it('does not count completions of cases removed from the catalog', async () => {
    await complete('u1', 'c1');
    await complete('u1', 'removed');

    await expect(progress.execute({ uid: 'u1' })).resolves.toEqual({
      completedCount: 1,
      totalCount: 3,
    });
  });

  it('excludes hidden (untranslated) cases from total and completed', async () => {
    catalog.set([
      makeCase('c1'),
      makeCase('hidden', {
        content: { en: makeCase('x').localize('en')! },
      }),
    ]);
    await complete('u1', 'hidden');
    await complete('u1', 'c1');

    await expect(progress.execute({ uid: 'u1' })).resolves.toEqual({
      completedCount: 1,
      totalCount: 1,
    });
  });

  it('handles an empty catalog', async () => {
    catalog.set([]);
    await complete('u1', 'c1');
    await expect(progress.execute({ uid: 'u1' })).resolves.toEqual({
      completedCount: 0,
      totalCount: 0,
    });
  });
});
