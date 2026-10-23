import {
  InMemoryCaseCatalog,
  InMemoryCaseCompletionRepository,
  makeCase,
} from './fakes';
import { ListCases } from './list-cases';

describe('ListCases', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  let catalog: InMemoryCaseCatalog;
  let completions: InMemoryCaseCompletionRepository;
  let list: ListCases;

  beforeEach(() => {
    catalog = new InMemoryCaseCatalog();
    completions = new InMemoryCaseCompletionRepository();
    list = new ListCases(catalog, completions);
  });

  it('returns an empty list for an empty catalog', async () => {
    await expect(list.execute({ uid: 'u1' }, 'en')).resolves.toEqual([]);
  });

  it('keeps catalog order and the per-user completion state', async () => {
    catalog.set([makeCase('b'), makeCase('a'), makeCase('c')]);
    await completions.recordIfAbsent({
      userId: 'u1',
      caseId: 'a',
      completedAt: at,
    });

    const mine = await list.execute({ uid: 'u1' }, 'en');
    const theirs = await list.execute({ uid: 'u2' }, 'en');

    expect(mine.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(mine.map((c) => c.completed)).toEqual([false, true, false]);
    expect(mine[1].completedAt).toEqual(at);
    expect(theirs.every((c) => !c.completed && c.completedAt === null)).toBe(
      true,
    );
  });

  it('localizes and omits hidden cases', async () => {
    catalog.set([
      makeCase('a', {
        content: {
          en: {
            title: 'T',
            teaser: 't',
            scenario: 's',
            patientName: 'P',
            contentNote: null,
          },
          ru: {
            title: 'Т',
            teaser: 'т',
            scenario: 'с',
            patientName: 'П',
            contentNote: null,
          },
        },
      }),
      makeCase('hidden', { content: {} }),
    ]);
    const ru = await list.execute({ uid: 'u1' }, 'ru');
    expect(ru.map((c) => [c.id, c.title])).toEqual([['a', 'Т']]);
  });
});
