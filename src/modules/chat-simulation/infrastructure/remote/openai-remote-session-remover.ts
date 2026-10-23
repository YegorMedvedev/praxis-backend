import { Logger } from '@nestjs/common';
import type { RemoteSessionRemover } from '../../domain/remote-session-remover';
import {
  errorClassOf,
  httpStatusOf,
  requestIdOf,
  type OpenAiAgentsClient,
} from './openai-agents-client';
import type { GeneratorLogger } from './openai-patient-reply-generator';

/**
 * Deletes a remote OpenAI session for the cleanup worker. "Not found" means
 * it is already gone and counts as success; any other failure is rethrown
 * (with a message that carries no provider text) so the worker retries.
 */
export class OpenAiRemoteSessionRemover implements RemoteSessionRemover {
  constructor(
    private readonly client: OpenAiAgentsClient,
    private readonly logger: GeneratorLogger = new Logger(
      OpenAiRemoteSessionRemover.name,
    ),
  ) {}

  async remove(openaiSessionId: string): Promise<void> {
    try {
      await this.client.deleteSession(openaiSessionId);
    } catch (error) {
      const status = httpStatusOf(error);
      if (status === 404) return;
      const requestId = requestIdOf(error);
      this.logger.warn(
        `event=openai_session_delete_failed error_class=${errorClassOf(error)}` +
          (status === undefined ? '' : ` http_status=${status}`) +
          (requestId ? ` openai_request_id=${requestId}` : ''),
      );
      if (status === 401 || status === 403) {
        this.logger.error(`event=openai_auth_failed http_status=${status}`);
      }
      throw new RemoteSessionDeletionFailedError(status);
    }
  }
}

/** Carries the HTTP status at most; never provider text or the remote id. */
export class RemoteSessionDeletionFailedError extends Error {
  constructor(readonly status: number | undefined) {
    super('remote session deletion failed');
    this.name = 'RemoteSessionDeletionFailedError';
  }
}
