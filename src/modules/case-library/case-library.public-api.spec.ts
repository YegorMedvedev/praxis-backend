import {
  RecordCaseCompletion,
  type CaseCompletionRecorder,
} from './case-library.public-api';
import {
  InMemoryCaseCatalog,
  InMemoryCaseCompletionRepository,
  makeCase,
} from './application/fakes';
import { GetCaseProgress } from './application/get-case-progress';

/** Stand-in for chat-simulation's session-end operation. */
class FakeSessionEnder {
  constructor(private readonly recorder: CaseCompletionRecorder) {}

  end(userId: string, caseId: string) {
    return this.recorder.execute({ userId, caseId });
  }
}

describe('case-library public API', () => {
  it('lets another module record a completion idempotently', async () => {
    const completions = new InMemoryCaseCompletionRepository();
    const ender = new FakeSessionEnder(
      new RecordCaseCompletion(completions, { now: () => new Date() }),
    );
    const catalog = new InMemoryCaseCatalog([makeCase('c1'), makeCase('c2')]);

    await expect(ender.end('u1', 'c1')).resolves.toEqual({ recorded: true });
    await expect(ender.end('u1', 'c1')).resolves.toEqual({ recorded: false });

    await expect(
      new GetCaseProgress(catalog, completions).execute({ uid: 'u1' }),
    ).resolves.toEqual({ completedCount: 1, totalCount: 2 });
  });
});
