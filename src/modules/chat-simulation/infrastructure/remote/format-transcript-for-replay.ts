import type { Language } from '../../domain/language';
import type { Message } from '../../domain/message';
import { REPLAY_FORMAT } from './placeholder-prompts';

/**
 * Pure. Formats the stored transcript plus the pending therapist message as
 * one input for a fresh remote session: role-labelled lines in chronological
 * order (the order given), with the pending message last, exactly once.
 * The wording is PLACEHOLDER text (see `placeholder-prompts.ts`).
 */
export function formatTranscriptForReplay(
  language: Language,
  history: readonly Pick<Message, 'role' | 'text'>[],
  pending: Pick<Message, 'role' | 'text'> | null,
): string {
  const format = REPLAY_FORMAT[language];
  const lines = [...history, ...(pending ? [pending] : [])].map(
    (message) =>
      `${message.role === 'THERAPIST' ? format.therapist : format.patient}: ${message.text}`,
  );
  return [format.preamble, ...lines, format.respond].join('\n');
}
