import {
  FakeApiError,
  FakeOpenAiAgentsClient,
} from './fake-openai-agents-client';
import type { GeneratorLogger } from './openai-patient-reply-generator';
import { OpenAiRemoteSessionRemover } from './openai-remote-session-remover';

const PROVIDER_MARKER = 'MARKER-PROVIDER-MESSAGE-5d2e';
const REMOTE_ID_MARKER = 'sess_MARKER-REMOTE-ID-c4a8';

describe('OpenAiRemoteSessionRemover', () => {
  let client: FakeOpenAiAgentsClient;
  let lines: string[];
  let remover: OpenAiRemoteSessionRemover;

  beforeEach(() => {
    client = new FakeOpenAiAgentsClient();
    lines = [];
    const logger: GeneratorLogger = {
      log: (l) => lines.push(l),
      warn: (l) => lines.push(l),
      error: (l) => lines.push(l),
    };
    remover = new OpenAiRemoteSessionRemover(client, logger);
  });

  it('deletes the session by id', async () => {
    await remover.remove('sess_1');

    expect(client.calls).toEqual([{ op: 'delete', sessionId: 'sess_1' }]);
  });

  it('AC-8: treats "not found" as success', async () => {
    client.deleteError = new FakeApiError(404, PROVIDER_MARKER);

    await expect(remover.remove('sess_1')).resolves.toBeUndefined();
  });

  it.each([500, 503, 429, 401, undefined])(
    'AC-8: surfaces status %p so the worker retries, without provider text or ids',
    async (status) => {
      client.deleteError = new FakeApiError(status, PROVIDER_MARKER, 'req_1');

      const failure = await remover
        .remove(REMOTE_ID_MARKER)
        .catch((e: Error) => e);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).not.toContain(PROVIDER_MARKER);
      expect((failure as Error).message).not.toContain(REMOTE_ID_MARKER);
      expect(lines.join('\n')).not.toContain(PROVIDER_MARKER);
      expect(lines.join('\n')).not.toContain(REMOTE_ID_MARKER);
    },
  );

  it('logs openai_auth_failed for 401 and 403', async () => {
    client.deleteError = new FakeApiError(403, PROVIDER_MARKER);

    await remover.remove('sess_1').catch(() => undefined);

    expect(lines.join('\n')).toContain('event=openai_auth_failed');
  });
});
