import { InvalidRequestError } from '../../../shared/domain-error';

export const MESSAGE_ROLES = ['THERAPIST', 'PATIENT'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** Longest therapist message, in characters, after trimming. */
export const THERAPIST_MESSAGE_MAX_CHARS = 2000;
/** Longest patient reply, in characters. Longer replies fail, never cut. */
export const PATIENT_REPLY_MAX_CHARS = 2500;

/** One stored message of a session transcript. */
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  text: string;
  /** For a patient message: the time the reply completed. */
  createdAt: Date;
}

/** Length in characters (Unicode code points), not UTF-16 units. */
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * The text of a therapist message: trimmed, 1..2000 characters, and storable.
 * Violations are `invalid-request` on `text`; the value is never echoed.
 */
export function normalizeTherapistText(raw: string): string {
  const text = raw.trim();
  if (text.length === 0) {
    throw new InvalidRequestError('text is empty', [
      { name: 'text', reason: 'TOO_SHORT' },
    ]);
  }
  if (characterCount(text) > THERAPIST_MESSAGE_MAX_CHARS) {
    throw new InvalidRequestError('text is too long', [
      { name: 'text', reason: 'TOO_LONG' },
    ]);
  }
  // PostgreSQL text cannot hold NUL.
  if (text.includes('\u0000')) {
    throw new InvalidRequestError('text has an invalid character', [
      { name: 'text', reason: 'INVALID_VALUE' },
    ]);
  }
  return text;
}
