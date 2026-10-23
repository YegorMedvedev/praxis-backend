import type { SessionGenerationCanceller } from '../../domain/session-generation-canceller';

/**
 * PLACEHOLDER until task 02 binds its in-process generation registry. No reply
 * can be generated yet, so there is nothing to cancel.
 */
export class NoActiveGenerations implements SessionGenerationCanceller {
  cancel(): void {
    // Nothing is ever generating before the message exchange exists.
  }
}
