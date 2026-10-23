/**
 * Port: deletes a remote (OpenAI) session. Resolves when the session is gone,
 * whether it was deleted now or was already gone. Rejects on any other
 * failure, so the cleanup worker retries. Implemented by task 07.
 */
export interface RemoteSessionRemover {
  remove(openaiSessionId: string): Promise<void>;
}
