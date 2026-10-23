import type { Language } from '../../domain/language';

/**
 * PLACEHOLDER TEXT, NOT APPROVED CONTENT (spec 07 OQ-2, HUMAN-REQUIRED).
 *
 * These strings are prompt-like text the product owner must review and
 * replace. They are deliberately neutral and make no clinical claims. They
 * live in this single file so they are easy to find and change.
 */

/**
 * PLACEHOLDER. First input of a new remote session: asks the saved agent to
 * start the conversation as the patient. One string per session language.
 */
export const PATIENT_OPENING_INPUT: Readonly<Record<Language, string>> = {
  en: '[PLACEHOLDER opening input] The session has started. Please begin the conversation as the patient.',
  ru: '[PLACEHOLDER opening input] Сессия началась. Пожалуйста, начните разговор в роли пациента.',
};

/**
 * PLACEHOLDER. Wording used by `formatTranscriptForReplay` when a stored
 * transcript is replayed into a fresh remote session.
 */
export const REPLAY_FORMAT: Readonly<
  Record<
    Language,
    { preamble: string; therapist: string; patient: string; respond: string }
  >
> = {
  en: {
    preamble:
      '[PLACEHOLDER replay format] The conversation so far, oldest first:',
    therapist: 'Therapist',
    patient: 'Patient',
    respond: 'Reply as the patient to the last therapist message.',
  },
  ru: {
    preamble:
      '[PLACEHOLDER replay format] Разговор до этого момента, от первого сообщения к последнему:',
    therapist: 'Терапевт',
    patient: 'Пациент',
    respond: 'Ответьте как пациент на последнее сообщение терапевта.',
  },
};
