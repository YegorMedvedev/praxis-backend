import type { Message } from './message';

/**
 * The stored transcript. Every method takes part in the active unit of work.
 * Callers establish ownership of the session first; this port does not.
 */
export interface MessageRepository {
  /** Messages in the order they were stored (ascending `created_at`). */
  listBySession(sessionId: string): Promise<Message[]>;
  /** The most recently stored message, or null for an empty transcript. */
  findLast(sessionId: string): Promise<Message | null>;
  append(message: Message): Promise<void>;
}

/** A reply is pending when the last stored message is not the patient's. */
export function isReplyPending(last: Message | null): boolean {
  return last === null || last.role !== 'PATIENT';
}
