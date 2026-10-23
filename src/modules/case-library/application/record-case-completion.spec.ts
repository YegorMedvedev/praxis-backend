import { ValidationFailedError } from '../../../shared/domain-error';
import { InMemoryCaseCompletionRepository } from './fakes';
import { CompletionIndex } from './completion-index';
import { RecordCaseCompletion } from './record-case-completion';

describe('RecordCaseCompletion', () => {
  let completions: InMemoryCaseCompletionRepository;
  let now: Date;
  let record: RecordCaseCompletion;

  beforeEach(() => {
    completions = new InMemoryCaseCompletionRepository();
    now = new Date('2026-01-01T10:00:00Z');
    record = new RecordCaseCompletion(completions, { now: () => now });
  });

  it('records the first completion with the current time', async () => {
    await expect(
      record.execute({ userId: 'u1', caseId: 'c1' }),
    ).resolves.toEqual({ recorded: true });
    await expect(completions.findByUserAndCase('u1', 'c1')).resolves.toEqual({
      userId: 'u1',
      caseId: 'c1',
      completedAt: now,
    });
  });

  it('is idempotent: the first completed_at wins', async () => {
    await record.execute({ userId: 'u1', caseId: 'c1' });
    now = new Date('2026-02-01T10:00:00Z');

    await expect(
      record.execute({ userId: 'u1', caseId: 'c1' }),
    ).resolves.toEqual({ recorded: false });

    const stored = await completions.findByUser('u1');
    expect(stored).toHaveLength(1);
    expect(stored[0].completedAt).toEqual(new Date('2026-01-01T10:00:00Z'));
  });

  it('keeps users apart', async () => {
    await record.execute({ userId: 'u1', caseId: 'c1' });
    await expect(completions.findByUser('u2')).resolves.toEqual([]);
  });

  it('records a case that is not in the catalog (completion outlives it)', async () => {
    await expect(
      record.execute({ userId: 'u1', caseId: 'gone' }),
    ).resolves.toEqual({ recorded: true });
  });

  it('accepts ids of exactly 128 characters', async () => {
    await expect(
      record.execute({ userId: 'u'.repeat(128), caseId: 'c'.repeat(128) }),
    ).resolves.toEqual({ recorded: true });
  });

  it.each([
    ['', 'c1'],
    ['u1', ''],
    ['  ', 'c1'],
    ['u1', 'x'.repeat(129)],
    ['u'.repeat(129), 'c1'],
    ['u1', 'c\u00001'],
    ['u\u00001', 'c1'],
  ])(
    'rejects blank, over-long or NUL-containing ids (%p, %p)',
    async (userId, caseId) => {
      await expect(record.execute({ userId, caseId })).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
    },
  );
});

describe('CompletionIndex', () => {
  it('reports completed state per case', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const index = new CompletionIndex([
      { userId: 'u1', caseId: 'c1', completedAt: at },
    ]);
    expect(index.stateFor('c1')).toEqual({ completed: true, completedAt: at });
    expect(index.stateFor('c2')).toEqual({
      completed: false,
      completedAt: null,
    });
  });
});
