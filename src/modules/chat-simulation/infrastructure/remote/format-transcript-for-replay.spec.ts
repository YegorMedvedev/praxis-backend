import { formatTranscriptForReplay } from './format-transcript-for-replay';
import { REPLAY_FORMAT } from './placeholder-prompts';

const history = [
  { role: 'THERAPIST' as const, text: 'first therapist line' },
  { role: 'PATIENT' as const, text: 'first patient line' },
  { role: 'THERAPIST' as const, text: 'second therapist line' },
  { role: 'PATIENT' as const, text: 'second patient line' },
];
const pending = { role: 'THERAPIST' as const, text: 'the pending line' };

describe('formatTranscriptForReplay', () => {
  it('labels roles and keeps chronological order, pending last', () => {
    const lines = formatTranscriptForReplay('en', history, pending).split('\n');

    expect(lines).toEqual([
      REPLAY_FORMAT.en.preamble,
      'Therapist: first therapist line',
      'Patient: first patient line',
      'Therapist: second therapist line',
      'Patient: second patient line',
      'Therapist: the pending line',
      REPLAY_FORMAT.en.respond,
    ]);
  });

  it('contains the pending message exactly once', () => {
    const out = formatTranscriptForReplay('en', history, pending);

    expect(out.split('the pending line')).toHaveLength(2);
  });

  it('uses the session language labels', () => {
    const out = formatTranscriptForReplay('ru', history, pending);

    expect(out).toContain('Терапевт: the pending line');
    expect(out).toContain('Пациент: first patient line');
  });

  it('formats a history with no pending message', () => {
    const out = formatTranscriptForReplay('en', history, null);

    expect(out).toContain('Patient: second patient line');
    expect(out).not.toContain('the pending line');
  });

  it('is pure: the same input gives the same output and nothing is mutated', () => {
    const copy = structuredClone(history);

    expect(formatTranscriptForReplay('en', history, pending)).toBe(
      formatTranscriptForReplay('en', history, pending),
    );
    expect(history).toEqual(copy);
  });
});
