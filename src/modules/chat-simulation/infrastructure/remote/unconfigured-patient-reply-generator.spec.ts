import { ReplyGenerationFailedError } from '../../../../shared/domain-error';
import { UnconfiguredPatientReplyGenerator } from './unconfigured-patient-reply-generator';

describe('UnconfiguredPatientReplyGenerator', () => {
  it('never produces content: every reply fails as reply-generation-failed', async () => {
    const chunks: unknown[] = [];
    const consume = async () => {
      for await (const chunk of new UnconfiguredPatientReplyGenerator().generate()) {
        chunks.push(chunk);
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(ReplyGenerationFailedError);
    expect(chunks).toEqual([]);
  });
});
