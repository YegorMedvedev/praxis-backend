import { CaseNotFoundError } from '../../../shared/domain-error';
import {
  InMemoryCaseCatalog,
  InMemoryCaseCompletionRepository,
  makeCase,
} from './fakes';
import { GetCase } from './get-case';
import { ListCases } from './list-cases';

describe('GetCase', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  let catalog: InMemoryCaseCatalog;
  let completions: InMemoryCaseCompletionRepository;
  let get: GetCase;

  beforeEach(() => {
    catalog = new InMemoryCaseCatalog([
      makeCase('a'),
      makeCase('hidden', { content: {} }),
    ]);
    completions = new InMemoryCaseCompletionRepository();
    get = new GetCase(catalog, completions);
  });

  it('returns the case with the caller completion state', async () => {
    await completions.recordIfAbsent({
      userId: 'u1',
      caseId: 'a',
      completedAt: at,
    });
    await expect(get.execute({ uid: 'u1' }, 'a', 'en')).resolves.toMatchObject({
      id: 'a',
      completed: true,
      completedAt: at,
    });
    await expect(get.execute({ uid: 'u2' }, 'a', 'en')).resolves.toMatchObject({
      completed: false,
      completedAt: null,
    });
  });

  it('shares its fields with the list item', async () => {
    const list = new ListCases(catalog, completions);
    const [item] = await list.execute({ uid: 'u1' }, 'ru');
    await expect(get.execute({ uid: 'u1' }, 'a', 'ru')).resolves.toEqual(item);
  });

  it.each(['missing', 'hidden', '', '../x'])(
    'throws CaseNotFoundError for %p',
    async (id) => {
      await expect(get.execute({ uid: 'u1' }, id, 'en')).rejects.toBeInstanceOf(
        CaseNotFoundError,
      );
    },
  );
});
