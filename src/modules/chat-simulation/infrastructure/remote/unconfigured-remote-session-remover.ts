import type { RemoteSessionRemover } from '../../domain/remote-session-remover';

/** Thrown for every attempt; carries no remote detail. */
export class RemoteSessionRemoverNotConfiguredError extends Error {
  constructor() {
    super('no remote session remover is configured');
    this.name = 'RemoteSessionRemoverNotConfiguredError';
  }
}

/**
 * PLACEHOLDER until task 07 binds the real OpenAI remover. It always fails, so
 * a queued remote session is never reported as deleted and stays queued with
 * backoff. This is safe in production: before task 07 no session ever gets an
 * `openai_session_id`, so the queue is empty.
 */
export class UnconfiguredRemoteSessionRemover implements RemoteSessionRemover {
  remove(): Promise<void> {
    return Promise.reject(new RemoteSessionRemoverNotConfiguredError());
  }
}
